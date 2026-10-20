function r = compare_signals(x, y)
%COMPARE_SIGNALS RMS and mean-squared difference of two ALIGNED signals (error if sizes differ).
%   MSE measures signal change; it is not a quality or denoising score.
    if ~isequal(size(x), size(y)), error('signals are not aligned: sizes differ'); end
    r.rms_before = sqrt(mean(x.^2,1)); r.rms_after = sqrt(mean(y.^2,1));
    r.mse = mean((x-y).^2,1);
end
