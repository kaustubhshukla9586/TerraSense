"""
TerraScan — ML Training Script (train.py)
==========================================
Trains a PLSR model on the mock dataset.
Pipeline already applied in CSV:  Reflectance → Absorbance → SG-smooth → SNV
So we use the SNV columns directly as X features.

Outputs:
  - plsr_model.pkl   (trained PLSR model, joblib-serialised)
  - prints R² and RMSE per nutrient on the test set
"""

import numpy as np
import pandas as pd
from sklearn.cross_decomposition import PLSRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_squared_error
import joblib

# ── 1. Load dataset ──────────────────────────────────────────────
df = pd.read_csv('terrascan_mock_dataset.csv')
print(f"Dataset loaded: {df.shape[0]} samples, {df.shape[1]} columns")

# ── 2. Extract features (SNV columns) and labels ────────────────
#   SNV columns are the fully preprocessed spectral features
#   (Reflectance → log(1/R) Absorbance → SG-smooth → SNV normalised)
snv_cols = [c for c in df.columns if c.startswith('SNV_')]
label_cols = ['TN_pct', 'P_mgkg', 'K_mgkg', 'OC_pct']

X = df[snv_cols].values          # shape: (100, 161)
y = df[label_cols].values        # shape: (100, 4)

print(f"Features (X): {X.shape}  —  {len(snv_cols)} SNV wavelengths")
print(f"Labels   (y): {y.shape}  —  {label_cols}")

# ── 3. Train / test split (80/20) ───────────────────────────────
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)
print(f"\nTrain: {X_train.shape[0]} samples  |  Test: {X_test.shape[0]} samples")

# ── 4. Train PLSR model (SRS REQ-F03-01) ────────────────────────
#   n_components = 10  (standard starting point for NIR spectral data)
#   Multi-output: predicts N, P, K, OC simultaneously
model = PLSRegression(n_components=10)
model.fit(X_train, y_train)
print("\nPLSR model trained (n_components=10)")

# ── 5. Evaluate on test set ─────────────────────────────────────
y_pred = model.predict(X_test)

print("\n── Test Set Metrics ──────────────────────────")
print(f"{'Nutrient':<12} {'R²':>8} {'RMSE':>10}")
print("-" * 32)
for i, name in enumerate(label_cols):
    r2   = r2_score(y_test[:, i], y_pred[:, i])
    rmse = np.sqrt(mean_squared_error(y_test[:, i], y_pred[:, i]))
    print(f"{name:<12} {r2:>8.4f} {rmse:>10.4f}")

# ── 6. Save model ───────────────────────────────────────────────
joblib.dump(model, 'plsr_model.pkl')
print("\nModel saved → plsr_model.pkl")
print("Hand this file + predict.py to Kaustubh for backend integration.")
