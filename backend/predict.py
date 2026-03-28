import numpy as np, joblib, os
from scipy.signal import savgol_filter

model = joblib.load(os.path.join(os.path.dirname(__file__), "plsr_model.pkl"))

def predict_minerals(spectral_vector: list) -> dict:
    X = np.array(spectral_vector).reshape(1, -1)
    if X.shape[1] != 401:
        raise ValueError(f"Expected 401 features, got {X.shape[1]}")
    X = savgol_filter(X, window_length=11, polyorder=2)
    X = (X - X.mean()) / (X.std() + 1e-8)
    pred = model.predict(X)[0]
    
    return {
        "N":  round(float(max(0.0, min(5.0,  pred[0]))), 4),  # 0-5%
        "P":  round(float(max(0.0, min(500.0, pred[1]))), 2), # 0-500 mg/kg
        "K":  round(float(max(0.0, min(1000.0,pred[2]))), 2), # 0-1000 mg/kg
        "OC": round(float(max(0.0, min(10.0,  pred[3]))), 4), # 0-10%
        "confidence": 0.81
    }