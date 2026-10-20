function [f, amp] = calculate_single_sided_spectrum(x, fs, windowName, nfft)
%CALCULATE_SINGLE_SIDED_SPECTRUM Calibrated single-sided amplitude spectrum (base MATLAB only).
%   Same convention as backend/app/processing/fft_analysis.py:
%   amp = 2|X|/sum(w) (DC and Nyquist not doubled). Symmetric Hann window.
    x = x(:);  N = numel(x);
    if N < 2 || ~all(isfinite(x)), error('x must be finite with >= 2 samples'); end
    if nargin < 3, windowName = 'hann'; end
    if nargin < 4 || isempty(nfft), nfft = N; end
    if nfft < N, error('nfft must be >= numel(x)'); end
    switch lower(windowName)
        case 'hann', n = (0:N-1)'; w = 0.5 - 0.5*cos(2*pi*n/(N-1));
        case {'rect','rectangular'}, w = ones(N,1);
        otherwise, error('unsupported window');
    end
    X = fft(x .* w, nfft);
    nb = floor(nfft/2) + 1;
    amp = abs(X(1:nb)) / sum(w);
    if mod(nfft,2) == 0, amp(2:end-1) = 2*amp(2:end-1); else, amp(2:end) = 2*amp(2:end); end
    f = (0:nb-1)' * fs / nfft;
end
