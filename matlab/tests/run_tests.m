% Run from the repository root:  matlab -batch "addpath('matlab/functions'); run('matlab/tests/run_tests.m')"
fs = 16000; t = (0:fs-1)'/fs;
x = 0.8*sin(2*pi*1000*t);
[f, a] = calculate_single_sided_spectrum(x, fs, 'hann');
[~, k] = max(a);
assert(f(k) == 1000, 'peak frequency wrong');
assert(abs(a(k) - 0.8) < 5e-3, 'amplitude calibration wrong');
[~, a0] = calculate_single_sided_spectrum(0.25*ones(1000,1), fs, 'rect'); assert(abs(a0(1)-0.25) < 1e-12);
if exist('butter','file') == 2
    sos = design_digital_filter('low', 4, 1000, fs); assert(size(sos,2) == 6);
else, disp('Signal Processing Toolbox not found: filter test skipped'); end
disp('MATLAB tests passed');
