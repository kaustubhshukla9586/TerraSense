# TerraSense
TerraSense is a new, self-contained product family with no predecessor system. It is designed to operate within the broader precision agriculture ecosystem alongside GPS mapping tools, irrigation management software, and farm management information systems (FMIS).


# TerraSense API Contract

## POST /api/v1/predict
Input:
```json
{ "spectral_vector": [0.12, 0.45, ...] }  // array of exactly 228 floats
```
Output:
```json
{ "N": 2.34, "P": 120.5, "K": 450.0, "OC": 3.1, "confidence": 0.87, "timestamp": "2026-03-27T10:00:00" }
```

## GET /api/v1/history
Output:
```json
[ { "N": 2.34, "P": 120.5, "K": 450.0, "OC": 3.1, "confidence": 0.87, "timestamp": "..." }, ... ]
// returns last 20 scans
```

## GET /health
Output:
```json
{ "status": "ok" }
```