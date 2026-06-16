---
name: benchmark-docker
description: >
  Benchmark pipeline for fsregistration. Docker-based benchmarking for 7
  registration methods. Key: merge_and_deduplicate.py deletes batch files
  after merging, so resume signal is in outfile_*.csv, NOT batch files.
---

# Benchmark Pipeline

**Location**: `volumeROS/.benchmark_docker/` + `volumeROS/src/fsregistration/pythonScripts/matchingProfiling3D/`

## Pipeline Architecture

```
run_fpfh.sh (or run_icp.sh, run_soft.sh, etc.)
  → docker-entrypoint-benchmark.sh <method> [workers]
      → runFPFH_batch.sh (or runICP_batch.sh, etc.)
          for each noise_level × data_type:
              run_parallel_batches.py   ← scans batch_*.csv, skips completed
              merge_and_deduplicate.py  ← merges → outfile_*.csv, DELETES batch_*.csv
```

## Critical Insight

**`merge_and_deduplicate.py` deletes batch files after merging.**

On re-run: no batch files exist → `run_parallel_batches.py` sees nothing to skip → reprocesses everything.

**Resume signal is in `outfile_*.csv`, not batch files.**

To resume efficiently, add a skip check in `run*_batch.sh` loop:
```bash
OUTPUT_FILE="outputFiles/${MODEL_TYPE}/outfile_${MODEL_TYPE}_${noise_level}_${data_type}.csv"
if [ -f "$OUTPUT_FILE" ] && [ "$(($(wc -l < "$OUTPUT_FILE") - 1))" -eq "$EXPECTED_ROWS" ]; then
    echo "SKIP: $MODEL_TYPE $noise_level/$data_type"
    continue
fi
```

## Methods

| Method | Script | Conda Env | Model Type |
|--------|--------|-----------|------------|
| FPFH | runFPFH_batch.sh | geo_env | fpfh |
| ICP | runICP_batch.sh | geo_env | icp |
| GeoTransformer | runGeoTransformer_batch.sh | geo_env | geotransformer |
| RegTR | runRegTR_batch.sh | regtr_env | regtr |
| HybridPoint | runHybridPoint_batch.sh | hybridpoint_env | hybridpoint |
| PointRegGPT | runPointRegGPT_batch.sh | pointreggpt_env | pointreggpt |
| SOFT | runSoft_batch.sh | ml | soft |

## Noise Levels (7)
`low_gauss`, `high_gauss`, `low_salt_pepper`, `high_salt_pepper`, `None`, `low`, `high`

## Data Types (2)
`val` (1,331 rows), `train` (20,642 rows)

## Total Combos
7 noise × 2 data = **14 combos per method** (SOFT: 28 with N32 + N64)

## Row Counts

| Data type | Rows (data) | Rows (file, incl. header) |
|-----------|------------|--------------------------|
| train     | 20,642     | 20,643                   |
| val       | 1,331      | 1,332                    |

## Output Paths

| Method | Pattern | Example |
|--------|---------|---------|
| fpfh/icp/geotransformer/regtr/hybridpoint/pointreggpt | `outputFiles/{method}/outfile_{method}_{noise}_{data}.csv` | `outputFiles/fpfh/outfile_fpfh_high_gauss_train.csv` |
| soft N32 | `outputFiles/soft/outfile_soft_N32_{noise}_{data}.csv` | `outputFiles/soft/outfile_soft_N32_high_gauss_train.csv` |
| soft N64 | `outputFiles/soft/outfile_soft_N64_{noise}_{data}.csv` | `outputFiles/soft/outfile_soft_N64_high_gauss_train.csv` |

## Running

```bash
# Full run (rebuilds Docker + workspace every time)
bash .benchmark_docker/benchmark_methods/run_fpfh.sh 15

# Direct docker run (skip rebuilds, use if fsbench:latest exists)
docker run --rm \
  -v $(pwd):/home/benchmark/ros_ws \
  -v $(pwd)/dataFolder:/data:ro \
  -v $(pwd)/weights:/volume/weights:ro \
  -v ./test_results/:/volume/results \
  fsbench:latest /usr/local/bin/docker-entrypoint-benchmark.sh fpfh 15
```

## Resuming After Interruption

### Quick fix (no changes needed)
Re-run the same command. `run_parallel_batches.py` skips completed batches. Already-merged combos reprocess but produce correct output (deduplication handles duplicates).

### Efficient resume (add skip checks)
Add row-count check in `run*_batch.sh` loop before each `run_parallel_batches.py` call. See Critical Insight above.

### Skip Docker rebuilds
Add `docker image inspect` check in `run_fpfh.sh` Step 1 and `ros_ws/install/soft20` check in Step 2.

## Common Pitfalls

1. **Don't modify `merge_and_deduplicate.py` to keep batch files** — it works but wastes disk space. Better: add skip checks in `run*_batch.sh`.
2. **Don't over-engineer with pre-checks** — loop-level skip is sufficient.
3. **Don't create shared helper files for 2-line checks** — inline the check.
4. **SOFT has 2 variants** (N32 and N64) — both need separate skip checks.
5. **Predator method** has only 3 noise levels (`None`, `low`, `high`) — different from other methods.

## File Locations

| File | Path |
|------|------|
| Benchmark entrypoint | `.benchmark_docker/docker-entrypoint-benchmark.sh` |
| Build entrypoint | `.benchmark_docker/docker-entrypoint-build.sh` |
| Dockerfile | `.benchmark_docker/Dockerfile` |
| Method scripts | `.benchmark_docker/benchmark_methods/run_*.sh` |
| Batch scripts | `src/fsregistration/pythonScripts/matchingProfiling3D/bashScripts/run*_batch.sh` |
| Batch dispatcher | `.../bashScripts/run_parallel_batches.py` |
| Merge script | `.../bashScripts/merge_and_deduplicate.py` |
| Per-method test scripts | `.../testing*.py` |
