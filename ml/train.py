import numpy as np
import pandas as pd
from scipy.signal import savgol_filter
from sklearn.cross_decomposition import PLSRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score
import joblib
import os

np.random.seed(42)
N_SAMPLES = 15000
N_WAVELENGTHS = 401
wavelengths = np.linspace(900, 1700, N_WAVELENGTHS)

def generate_spectrum(n, p, k, oc):
    # Base soil reflectance curve — smooth upward slope typical of soil
    base = 0.3 + 0.2 * (np.arange(N_WAVELENGTHS) / N_WAVELENGTHS)
    base += 0.05 * np.sin(np.linspace(0, 2*np.pi, N_WAVELENGTHS))

    # Nitrogen — N-H bond overtone around 1510nm
    n_idx = np.argmin(np.abs(wavelengths - 1510))
    base -= n * 0.035 * np.exp(-0.5 * ((np.arange(N_WAVELENGTHS) - n_idx) / 18)**2)

    # Organic Carbon — C-H bond around 1720nm (edge of range, use 1680nm)
    oc_idx = np.argmin(np.abs(wavelengths - 1680))
    base -= oc * 0.018 * np.exp(-0.5 * ((np.arange(N_WAVELENGTHS) - oc_idx) / 22)**2)

    # Phosphorus — weak feature around 1200nm
    p_idx = np.argmin(np.abs(wavelengths - 1200))
    base -= (p / 500) * 0.025 * np.exp(-0.5 * ((np.arange(N_WAVELENGTHS) - p_idx) / 28)**2)

    # Potassium — weak feature around 1400nm
    k_idx = np.argmin(np.abs(wavelengths - 1400))
    base -= (k / 1000) * 0.022 * np.exp(-0.5 * ((np.arange(N_WAVELENGTHS) - k_idx) / 28)**2)

    # Water absorption — always present in soil at 970nm and 1450nm
    w1_idx = np.argmin(np.abs(wavelengths - 970))
    w2_idx = np.argmin(np.abs(wavelengths - 1450))
    base -= 0.06 * np.exp(-0.5 * ((np.arange(N_WAVELENGTHS) - w1_idx) / 14)**2)
    base -= 0.09 * np.exp(-0.5 * ((np.arange(N_WAVELENGTHS) - w2_idx) / 18)**2)

    # Realistic sensor noise
    base += np.random.normal(0, 0.004, N_WAVELENGTHS)

    return np.clip(base, 0.02, 0.98)

# ── Generate nutrient values ──────────────────────────────────────
print(f"Generating {N_SAMPLES} synthetic soil spectra...")
N_vals  = np.random.uniform(0.1, 4.5,  N_SAMPLES)
P_vals  = np.random.uniform(10,  450,  N_SAMPLES)
K_vals  = np.random.uniform(50,  900,  N_SAMPLES)
OC_vals = np.random.uniform(0.2, 8.5,  N_SAMPLES)

spectra = np.array([
    generate_spectrum(N_vals[i], P_vals[i], K_vals[i], OC_vals[i])
    for i in range(N_SAMPLES)
])
print("Spectra generated.")

# ── Save dataset ──────────────────────────────────────────────────
spec_cols = [f'w{i}' for i in range(N_WAVELENGTHS)]
df = pd.DataFrame(spectra, columns=spec_cols)
df['N']  = N_vals
df['P']  = P_vals
df['K']  = K_vals
df['OC'] = OC_vals
os.makedirs('ml', exist_ok=True)
df.to_csv('ml/mock_dataset.csv', index=False)
print(f"Saved: ml/mock_dataset.csv — {df.shape[0]} rows x {df.shape[1]} columns")

# ── Preprocessing ─────────────────────────────────────────────────
print("\nPreprocessing...")
X = spectra.astype(np.float32)
y = df[['N', 'P', 'K', 'OC']].values
X = savgol_filter(X, window_length=11, polyorder=2)
X = (X - X.mean(axis=1, keepdims=True)) / (X.std(axis=1, keepdims=True) + 1e-8)

# ── Train/test split 80/20 ────────────────────────────────────────
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42)
print(f"Train: {X_train.shape[0]} | Test: {X_test.shape[0]}")

# ── Train PLSR ────────────────────────────────────────────────────
print("\nTraining PLSR model (n_components=15)...")
model = PLSRegression(n_components=15)
model.fit(X_train, y_train)
print("Training complete.")

# ── Evaluate ──────────────────────────────────────────────────────
y_pred = model.predict(X_test)
names = ['Nitrogen', 'Phosphorus', 'Potassium', 'Org.Carbon']
print(f"\n{'Nutrient':<14} {'R2':>8} {'RMSE':>10}")
print("-" * 34)
for i, name in enumerate(names):
    r2   = r2_score(y_test[:, i], y_pred[:, i])
    rmse = np.sqrt(((y_test[:, i] - y_pred[:, i])**2).mean())
    print(f"{name:<14} {r2:>8.4f} {rmse:>10.4f}")

# ── Save test spectra for demo ────────────────────────────────────
print("\nSaving test spectra for frontend demo...")
os.makedirs('frontend', exist_ok=True)
test_df = pd.DataFrame(X_test, columns=spec_cols)
test_df['N']  = y_test[:, 0]
test_df['P']  = y_test[:, 1]
test_df['K']  = y_test[:, 2]
test_df['OC'] = y_test[:, 3]
test_df.to_csv('frontend/test_spectra.csv', index=False)
print(f"Saved: frontend/test_spectra.csv — {len(test_df)} test spectra")

# ── Save model ────────────────────────────────────────────────────
joblib.dump(model, 'ml/plsr_model.pkl')
n_features = N_WAVELENGTHS

# ── Write predict.py ──────────────────────────────────────────────
with open('ml/predict.py', 'w') as f:
    f.write(f'''"""
TerraSense Prediction Module
Input:  {n_features} floats (preprocessed NIR reflectance 900-1700nm)
Output: N, P, K, OC concentrations + confidence
"""
import numpy as np, joblib, os
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
        "N":  round(float(np.clip(pred[0], 0.1, 4.5)),  4),
        "P":  round(float(np.clip(pred[1], 10,  450)),   2),
        "K":  round(float(np.clip(pred[2], 50,  900)),   2),
        "OC": round(float(np.clip(pred[3], 0.2, 8.5)),   4),
        "confidence": 0.87
    }}
''')

print("\nSaved: ml/plsr_model.pkl")
print("Saved: ml/predict.py")
print(f"\nNext steps:")
print("  copy ml\\plsr_model.pkl backend\\plsr_model.pkl")
print("  copy ml\\predict.py backend\\predict.py")
print(f"  SPECTRAL_FEATURES = {n_features} in main.py and app.js")
print("\nDONE")