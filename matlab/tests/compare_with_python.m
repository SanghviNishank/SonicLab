% Compares MATLAB results with values computed by the Python backend (python_reference.json).
% Run from repo root:  matlab -batch "addpath('matlab/functions'); run('matlab/tests/compare_with_python.m')"
% STATUS: written, NOT executed by the author (no MATLAB available). Report any failure.
ref = jsondecode(fileread('matlab/tests/python_reference.json'));
fs = ref.fs; t = (0:fs-1)'/fs;
x = 0.3*sin(2*pi*500*t) + 0.6*sin(2*pi*2500*t);
[f, a] = calculate_single_sided_spectrum(x, fs, 'hann');
[amp, k] = max(a);
tol = ref.tolerance;
assert(abs(f(k) - ref.hann_peak_hz) < tol, 'peak frequency differs');
assert(abs(amp - ref.hann_peak_amp) < 1e-6, 'peak amplitude differs (window definition?)');
assert(numel(f) == ref.n_bins, 'bin count differs');
s = calculate_audio_statistics(x);
assert(abs(s.rms - ref.rms) < 1e-9 && abs(s.variance - ref.variance_population) < 1e-9 && abs(s.peak_abs - ref.peak_abs) < 1e-9);
r = compare_signals(x, 0.5*x);
assert(abs(r.mse - ref.mse_vs_half_gain) < 1e-9);
disp('MATLAB matches Python reference values');
