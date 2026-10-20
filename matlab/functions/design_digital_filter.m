function sos = design_digital_filter(type, order, cutoffHz, fs)
%DESIGN_DIGITAL_FILTER Butterworth second-order sections. Requires Signal Processing Toolbox (butter).
    nyq = fs/2;
    if ~all(isfinite(cutoffHz)) || any(cutoffHz <= 0) || any(cutoffHz >= nyq)
        error('cutoffs must be finite, positive and below Nyquist'); end
    if numel(cutoffHz) == 2 && ~(cutoffHz(1) < cutoffHz(2)), error('need f_low < f_high'); end
    [z,p,k] = butter(order, cutoffHz/nyq, type);   % type: 'low','high','bandpass','stop'
    sos = zp2sos(z,p,k);
end
