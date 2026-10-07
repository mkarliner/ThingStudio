# Runs bench_cyd.py in mono mode (bench_cyd.py must be on the board).
import spike_cfg
spike_cfg.BENCH_MODE = 'mono'
import bench_cyd
