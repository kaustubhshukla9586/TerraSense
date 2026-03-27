from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import random, datetime

app = FastAPI(title='TerraSense API')

app.add_middleware(CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'])

scan_history = []

class ScanRequest(BaseModel):
    spectral_vector: List[float]

@app.get('/health')
def health():
    return {'status': 'ok'}

@app.post('/api/v1/predict')
def predict(req: ScanRequest):
    result = {
        'N': round(random.uniform(0.5, 4.5), 3),
        'P': round(random.uniform(50, 450), 2),
        'K': round(random.uniform(100, 900), 2),
        'OC': round(random.uniform(0.5, 8.5), 3),
        'confidence': 0.87,
        'timestamp': datetime.datetime.now().isoformat()
    }
    scan_history.append(result)
    return result

@app.get('/api/v1/history')
def history():
    return scan_history[-20:]