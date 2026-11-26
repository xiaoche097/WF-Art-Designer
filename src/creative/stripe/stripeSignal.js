// Radix-2 transform used for the one-dimensional, zero-padded autocorrelation.
function fft(real, imag, inverse) {
    const n = real.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [real[i], real[j]] = [real[j], real[i]];
            [imag[i], imag[j]] = [imag[j], imag[i]];
        }
    }
    for (let length = 2; length <= n; length *= 2) {
        const half = length / 2;
        for (let k = 0; k < half; k++) {
            const angle = (inverse ? 2 : -2) * Math.PI * k / length;
            const cos = Math.cos(angle), sin = Math.sin(angle);
            for (let i = k; i < n; i += length) {
                const j = i + half;
                const r = cos * real[j] - sin * imag[j], v = sin * real[j] + cos * imag[j];
                real[j] = real[i] - r;
                imag[j] = imag[i] - v;
                real[i] += r;
                imag[i] += v;
            }
        }
    }
    if (inverse) for (let i = 0; i < n; i++) real[i] /= n;
}

function detrend(values) {
    const mid = (values.length - 1) / 2;
    let sum = 0, slope = 0, weights = 0;
    for (let i = 0; i < values.length; i++) {
        const x = i - mid;
        sum += values[i];
        slope += x * values[i];
        weights += x * x;
    }
    return values.map((value, i) => value - sum / values.length - (i - mid) * slope / weights);
}

export function measureStripePeriod(profile) {
    const signal = profile.map(detrend);
    const count = signal[0].length;
    let size = 1;
    while (size < count * 2) size *= 2;
    const spectrum = new Float64Array(size), totalPower = new Float64Array(count + 1);
    for (const channel of signal) {
        const real = new Float64Array(size), imag = new Float64Array(size);
        real.set(channel);
        fft(real, imag, false);
        for (let i = 0; i < size; i++) spectrum[i] += real[i] ** 2 + imag[i] ** 2;
        for (let i = 0; i < count; i++) totalPower[i + 1] += channel[i] ** 2;
    }
    for (let i = 1; i <= count; i++) totalPower[i] += totalPower[i - 1];
    if (totalPower[count] < count * 35) return null;
    fft(spectrum, new Float64Array(size), true);
    const maxLag = Math.floor(count / 2);
    const corr = Array.from({ length: maxLag + 2 }, (_, lag) =>
        spectrum[lag] / (Math.sqrt(totalPower[count - lag] * (totalPower[count] - totalPower[lag])) || 1));
    const peaks = [];
    for (let lag = 4; lag <= maxLag; lag++) {
        if (corr[lag] >= 0.53 && corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1]) peaks.push(lag);
    }
    if (!peaks.length) return null;
    const strongest = Math.max(...peaks.map(lag => corr[lag]));
    const lag = peaks.find(lag => corr[lag] >= strongest * 0.90);
    const curvature = corr[lag - 1] - 2 * corr[lag] + corr[lag + 1];
    const offset = curvature ? 0.5 * (corr[lag - 1] - corr[lag + 1]) / curvature : 0;
    const period = lag + offset;
    // Quadrature Gabor response of the projected profiles. It indicates how
    // strongly a repeat behaves as a local sinusoid, including unequal bands.
    let gaborEnergy = 0, envelopeEnergy = 0;
    for (const channel of signal) {
        let real = 0, imag = 0, power = 0;
        for (let i = 0; i < count; i++) {
            const position = i - (count - 1) / 2;
            const weight = Math.exp(-0.5 * (position / (count / 4)) ** 2);
            const phase = 2 * Math.PI * position / period;
            real += channel[i] * weight * Math.cos(phase);
            imag += channel[i] * weight * Math.sin(phase);
            power += weight * weight;
        }
        gaborEnergy += (real ** 2 + imag ** 2) / (power || 1);
        envelopeEnergy += channel.reduce((sum, value) => sum + value * value, 0);
    }
    return { period, correlation: Math.min(1, corr[lag]), gabor: Math.min(1, 2 * gaborEnergy / envelopeEnergy),
        contrast: Math.sqrt(totalPower[count] / count) };
}
