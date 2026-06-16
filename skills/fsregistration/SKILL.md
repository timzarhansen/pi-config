---
name: fsregistration
description: >
  Context for the fsregistration project – ROS2 C++ package with SOFT-based
  2D/3D sonar registration, ML registration methods (GeoTransformer, RegTR,
  HybridPoint, PointRegGPT), and Python profiling scripts.
---

# fsregistration Project

**Location**: `/home/tim-external/volumeROS/src/fsregistration/`

## Architecture

```
fsregistration/
├── src/                          # C++ source
│   ├── softRegistrationClass.cpp    # 2D registration (SO(3) correlation)
│   ├── softRegistrationClass3D.cpp  # 3D registration
│   ├── softCorrelationClass.cpp     # SO(3) correlation engine
│   └── serviceRegistration*.cpp     # ROS2 service nodes
├── include/                      # Headers
├── ml_registration/              # ML models (GeoTransformer, RegTR, etc.)
├── pythonScripts/
│   └── matchingProfiling3D/
│       ├── testing*.py           # Per-method test scripts
│       ├── bashScripts/
│       │   ├── runFPFH_batch.sh
│       │   ├── runSoft_batch.sh
│       │   ├── run_parallel_batches.py   ← batch dispatcher
│       │   └── merge_and_deduplicate.py  ← merges + DELETES batch files
│       └── configFiles/
│           ├── environment_geo.yml
│           ├── environment_hybridpoint.yml
│           └── environment_regtr.yml
├── weights/                      # Pre-trained model weights
└── find-peaks/                   # Persistent homology peak detection
```

## Key Code Paths

### C++ Registration (SOFT)
- `softRegistrationClass` → 2D sonar registration via FFT + spherical harmonics
- `softRegistrationClass3D` → 3D voxel registration
- `PeakFinder` → persistence-based 3D peak detection

### Python Profiling
- `testingFPFHOnPredatorData.py` → FPFH feature + RANSAC registration
- `testingSoftOnPredatorData.py` → SOFT registration testing
- `run_parallel_batches.py` → parallel batch processing with resume (checks batch_*.csv)
- `merge_and_deduplicate.py` → merges batch CSVs → outfile_*.csv, **DELETES batch files**

## Row Counts (all methods except predator)
- **train**: 20,642 samples
- **val**: 1,331 samples

## Output Pattern
- Batch files: `outputFiles/{method}/batch_{method}_{noise}_{data}_{start}_{end}.csv`
- Final output: `outputFiles/{method}/outfile_{method}_{noise}_{data}.csv`
- SOFT: `outfile_soft_N{N}_{noise}_{data}.csv`

## Benchmark Docker
See `skills/benchmark-docker/SKILL.md` for pipeline architecture.
