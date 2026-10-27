function H = evaluate_sos_response(sos, freqsHz, fs)
%EVALUATE_SOS_RESPONSE Complex frequency response of a cascade of biquads (base MATLAB, no toolbox).
%   sos: L-by-6 [b0 b1 b2 a0 a1 a2] rows (as returned by design_digital_filter / zp2sos).
%   H(f) = prod_l (b0 + b1 z^-1 + b2 z^-2) / (a0 + a1 z^-1 + a2 z^-2),  z = exp(j*2*pi*f/fs).
    if size(sos,2) ~= 6, error('sos must be L-by-6'); end
    f = freqsHz(:); z1 = exp(-1j*2*pi*f/fs); z2 = z1.^2;
    H = ones(size(f));
    for l = 1:size(sos,1)
        H = H .* (sos(l,1) + sos(l,2)*z1 + sos(l,3)*z2) ./ (sos(l,4) + sos(l,5)*z1 + sos(l,6)*z2);
    end
end
