function s = calculate_audio_statistics(x)
%CALCULATE_AUDIO_STATISTICS Per-channel statistics, same conventions as the Python backend.
%   x: samples-by-channels double. Variance is the POPULATION variance (divide by N).
    if isempty(x) || ~isnumeric(x) || ~all(isfinite(x(:))), error('x must be non-empty, numeric and finite'); end
    if isvector(x), x = x(:); end
    s.min = min(x,[],1); s.max = max(x,[],1); s.mean = mean(x,1);
    s.rms = sqrt(mean(x.^2,1));
    s.variance = var(x,1,1);            % opt=1 -> population variance
    s.peak_abs = max(abs(x),[],1);
end
