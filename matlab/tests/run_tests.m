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
% statistics: samples-by-channels, population variance, analytic values for sine amplitude A: rms=A/sqrt(2), var=A^2/2
x2 = [0.8*sin(2*pi*1000*t), 0.4*sin(2*pi*500*t)];
s2 = calculate_audio_statistics(x2);
assert(numel(s2.rms) == 2 && abs(s2.rms(1) - 0.8/sqrt(2)) < 1e-9 && abs(s2.rms(2) - 0.4/sqrt(2)) < 1e-9, 'stereo rms');
assert(abs(s2.variance(1) - 0.32) < 1e-9 && abs(s2.variance(2) - 0.08) < 1e-9, 'population variance');
% compare_signals: halving the gain gives mse = (A^2/2)/4 per channel
c2 = compare_signals(x2, 0.5*x2);
assert(abs(c2.mse(1) - 0.32/4) < 1e-9 && abs(c2.rms_after(2)/c2.rms_before(2) - 0.5) < 1e-12, 'compare_signals');
% misaligned input must error, not guess
ok = false; try, compare_signals(x2, x2(1:end-1,:)); catch, ok = true; end
assert(ok, 'compare_signals must reject different sizes');
% evaluate_sos_response (no toolbox needed): one-pole check via a hand-built biquad  H = 1/(1 - 0.5 z^-1)
H = evaluate_sos_response([1 0 0 1 -0.5 0], 0, fs); assert(abs(H - 2) < 1e-12, 'sos response at DC');
disp('MATLAB tests passed');
