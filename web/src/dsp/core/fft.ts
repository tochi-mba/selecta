/** In-place radix-2 complex FFT, no browser or native runtime dependency. */
export function fft(real: Float64Array, imag: Float64Array, inverse = false): void {
  const n = real.length;
  if (imag.length !== n || n < 2 || (n & (n-1)) !== 0) throw new RangeError('FFT requires a power-of-two length');
  for (let i=1,j=0;i<n;i++) {
    let bit = n >> 1;
    for (;j & bit;bit >>= 1) j ^= bit;
    j ^= bit;
    if (i<j) { const r=real[i]; real[i]=real[j]; real[j]=r;
      const q=imag[i]; imag[i]=imag[j]; imag[j]=q; }
  }
  for (let width=2;width<=n;width*=2) {
    const step=(inverse?2:-2)*Math.PI/width, half=width>>1;
    const wr=Math.cos(step), wi=Math.sin(step);
    for (let base=0;base<n;base+=width) {
      let cr=1, ci=0;
      for (let k=0;k<half;k++) {
        const a=base+k,b=a+half,r=real[b]*cr-imag[b]*ci, im=real[b]*ci+imag[b]*cr;
        real[b]=real[a]-r; imag[b]=imag[a]-im; real[a]+=r; imag[a]+=im;
        const nr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=nr;
      }
    }
  }
  if (inverse) for (let i=0;i<n;i++) {real[i]/=n;imag[i]/=n;}
}
export function hann(n: number): Float64Array {
  return Float64Array.from({length:n},(_,i)=>0.5-0.5*Math.cos(2*Math.PI*i/n));
}
export function spectrum(signal: Float32Array, begin: number, n: number, window=hann(n)): {real: Float64Array;imag: Float64Array; power: Float64Array} {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i=0;i<n;i++) re[i] = (signal[begin+i]??0)*window[i];
  fft(re,im);
  const power = new Float64Array(n/2+1);
  for (let k=0;k<power.length;k++) power[k]=re[k]*re[k]+im[k]*im[k];
  return {real:re,imag:im,power};
}
