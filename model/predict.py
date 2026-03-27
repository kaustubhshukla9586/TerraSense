"""
TerraScan — Prediction Module (predict.py)
==========================================
Kaustubh imports this into the FastAPI backend:
    from predict import predict_minerals

Input:  list of 161 floats (SNV-normalised spectral values, 900–1700 nm)
Output: dict with keys N, P, K, OC, confidence
"""

import numpy as np
import joblib
import os

# Load model once at import time (not on every call)
_model_path = os.path.join(os.path.dirname(__file__), 'plsr_model.pkl')
model = joblib.load(_model_path)


def predict_minerals(spectral_vector: list) -> dict:
    """
    Takes a 161-float SNV spectral vector and returns nutrient predictions.
    The preprocessing (Reflectance → Absorbance → SG → SNV) is assumed
    to be done on the edge device before sending to the API.
    """
    X = np.array(spectral_vector).reshape(1, -1)

    # Validate input dimension
    if X.shape[1] != 161:
        raise ValueError(f"Expected 161 features (SNV wavelengths), got {X.shape[1]}")

    pred = model.predict(X)[0]

    return {
        'N':  round(float(pred[0]), 4),     # TN %
        'P':  round(float(pred[1]), 2),      # P mg/kg
        'K':  round(float(pred[2]), 2),      # K mg/kg
        'OC': round(float(pred[3]), 4),      # OC %
        'confidence': 0.87                    # placeholder — replace with real CI later
    }
