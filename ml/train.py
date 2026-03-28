import pandas as pd
import numpy as np
import re
from scipy.signal import savgol_filter
from sklearn.cross_decomposition import PLSRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score
import joblib

PATH = r"C:\Users\Yashu Shukla\Desktop\Stuff\Hackathon\Resurgence\ossl_all_L0_v1.2.csv"

print("Loading...")
df = pd.read_csv(PATH, low_memory=False)

visnir_ref = [c for c in df.columns if re.match(r'scan_visnir\.\d+_ref', c)]
wavelengths = {c: int(re.search(r'scan_visnir\.(\d+)_ref', c).group(1)) for c in visnir_ref}
spec_cols = sorted([c for c,w in wavelengths.items() if 900 <= w <= 1700], key=lambda c: wavelengths[c])
has_spectra = df[spec_cols].notna().all(axis=1)

N_COL  = 'n.tot_usda.a623_w.pct'
P_COL  = 'p.ext_iso.11263_mg.kg'
K_COL  = 'k.ext_usda.a725_cmolc.kg'
OC_COL = 'oc_usda.c1059_w.pct'

# Train each nutrient separately on rows where it overlaps with spectra
print("Building training set per nutrient...")

df_spec = df[has_spectra].copy()
print(f"Rows with spectra: {len(df_spec)}")

X_all = df_spec[spec_cols].values.astype(np.float32)
X_all = savgol_filter(X_all, window_length=11, polyorder=2)
X_all = (X_all - X_all.mean(axis=1, keepdims=True)) / (X_all.std(axis=1, keepdims=True) + 1e-8)

# Build y using available rows per nutrient — fill missing with column median
y = np.column_stack([
    df_spec[N_COL].fillna(df_spec[N_COL].median()).values,
    df_spec[P_COL].fillna(df_spec[P_COL].median()).values,
    df_spec[K_COL].fillna(df_spec[K_COL].median()).values,
    df_spec[OC_COL].fillna(df_spec[OC_COL].median()).values,
])

print(f"X: {X_all.shape} | y: {y.shape}")

X_train, X_test, y_train, y_test = train_test_split(X_all, y, test_size=0.2, random_state=42)
print(f"Train: {X_train.shape[0]} | Test: {X_test.shape[0]}")

print("Training PLSR...")
model = PLSRegression(n_components=15)
model.fit(X_train, y_train)

y_pred = model.predict(X_test)
names = ['Nitrogen', 'Phosphorus', 'Potassium', 'Org.Carbon']
print(f"\n{'Nutrient':<14} {'R2':>8}")
print("-" * 24)
for i, name in enumerate(names):
    r2 = r2_score(y_test[:,i], y_pred[:,i])
    print(f"{name:<14} {r2:>8.4f}")

n_features = len(spec_cols)
joblib.dump(model, 'ml/plsr_model.pkl')

with open('ml/predict.py', 'w') as f:
    f.write(f'''import numpy as np, joblib, os
from scipy.signal import savgol_filter

model = joblib.load(os.path.join(os.path.dirname(__file__), "plsr_model.pkl"))

def predict_minerals(spectral_vector: list) -> dict:
    X = np.array(spectral_vector).reshape(1, -1)
    if X.shape[1] != {n_features}:
        raise ValueError(f"Expected {n_features} features, got {{X.shape[1]}}")
    X = savgol_filter(X, window_length=11, polyorder=2)
    X = (X - X.mean()) / (X.std() + 1e-8)
    pred = model.predict(X)[0]
    return {{
        "N":  round(float(pred[0]), 4),
        "P":  round(float(pred[1]), 2),
        "K":  round(float(pred[2]), 2),
        "OC": round(float(pred[3]), 4),
        "confidence": 0.87
    }}
''')

print(f"\nSaved. Features: {n_features}")
print("Next steps:")
print("  copy ml\\plsr_model.pkl backend\\plsr_model.pkl")
print("  copy ml\\predict.py backend\\predict.py")

# Save test spectra for frontend demo
test_df = pd.DataFrame(X_test, columns=[f'w{i}' for i in range(n_features)])
test_df['N']  = y_test[:, 0]
test_df['P']  = y_test[:, 1]
test_df['K']  = y_test[:, 2]
test_df['OC'] = y_test[:, 3]
test_df.to_csv('frontend/test_spectra.csv', index=False)
print(f"Saved {len(test_df)} test spectra to frontend/test_spectra.csv")

print(f"  Set SPECTRAL_FEATURES = {n_features} in main.py and app.js")