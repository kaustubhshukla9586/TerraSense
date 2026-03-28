from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import datetime
import random
import string
import sys
import os
import pandas as pd
import numpy as np
from dotenv import load_dotenv

load_dotenv()

sys.path.append(os.path.dirname(__file__))
from predict import predict_minerals

app = FastAPI(title="TerraSense API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

scan_history: List[dict] = []

SPECTRAL_FEATURES = 401


class ScanRequest(BaseModel):
    spectral_vector: List[float]


class AdvisoryRequest(BaseModel):
    N: float
    P: float
    K: float
    OC: float
    pH: float
    moisture: float
    n_status: str
    p_status: str
    k_status: str
    oc_status: str
    ph_status: str
    moisture_status: str


def _random_scan_id(length: int = 6) -> str:
    chars = string.ascii_uppercase + string.digits
    chars = chars.replace("O", "").replace("I", "").replace("0", "").replace("1", "")
    return "".join(random.choice(chars) for _ in range(length))


# Load test spectra on startup
test_spectra = None
_test_path = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'test_spectra.csv')
if os.path.exists(_test_path):
    _test_df = pd.read_csv(_test_path)
    _spec_cols = [c for c in _test_df.columns if c.startswith('w')]
    test_spectra = _test_df[_spec_cols].values
    print(f"Loaded {len(test_spectra)} demo spectra")


@app.get("/health")
def health():
    return {"status": "ok", "model": "PLSR v1.0", "features": SPECTRAL_FEATURES}


@app.post("/api/v1/predict")
def predict(req: ScanRequest):
    vector = req.spectral_vector
    got = len(vector) if isinstance(vector, list) else -1
    if got != SPECTRAL_FEATURES:
        raise HTTPException(status_code=422, detail=f"Expected {SPECTRAL_FEATURES} features, got {got}")

    result = predict_minerals(vector)
    enriched = dict(result)
    enriched["timestamp"] = datetime.datetime.now().isoformat()
    enriched["scan_id"] = _random_scan_id(6)
    enriched["wavelength_range"] = "900-1700nm"
    enriched["preprocessing"] = "SG Filter + SNV"
    enriched["model"] = "PLSR v1.0"
    enriched["spectral_points"] = SPECTRAL_FEATURES

    scan_history.append(enriched)
    return enriched


@app.get("/api/v1/demo-spectrum")
def get_demo_spectrum():
    """Returns a real spectrum from test set for demo purposes"""
    if test_spectra is not None:
        idx = int(np.random.randint(0, len(test_spectra)))
        return {"spectral_vector": test_spectra[idx].tolist()}
    return {"spectral_vector": [float(np.random.uniform(0.1, 0.9)) for _ in range(SPECTRAL_FEATURES)]}


@app.get("/api/v1/history")
def history():
    return scan_history[-20:]


@app.post("/api/v1/advisory")
def advisory(req: AdvisoryRequest):
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured")

    from groq import Groq
    client = Groq(api_key=api_key)

    prompt = (
        f"You are an agricultural advisor for Indian farmers. Given soil analysis:\n"
        f"- Nitrogen: {req.N}% ({req.n_status})\n"
        f"- Phosphorus: {req.P} mg/kg ({req.p_status})\n"
        f"- Potassium: {req.K} mg/kg ({req.k_status})\n"
        f"- Organic Carbon: {req.OC}% ({req.oc_status})\n"
        f"- pH: {req.pH} ({req.ph_status}: Acidic if <6.0, Optimal if 6.0-7.5, Alkaline if >7.5)\n"
        f"- Soil Moisture: {req.moisture}% ({req.moisture_status}: Low if <15, Optimal if 15-25, High if >25)\n"
        f"For a farm in North India (Punjab region):\n"
        f"1. Top 3 suitable crops this season with brief reason\n"
        f"2. Specific fertilizer recommendations with quantity per hectare\n"
        f"3. Most urgent soil health action\n"
        f"Reply in simple language a farmer can understand. Be specific with quantities."
    )

    chat_completion = client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        model="llama-3.3-70b-versatile",
    )

    return {"advisory": chat_completion.choices[0].message.content}
