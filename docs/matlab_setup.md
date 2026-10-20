# MATLAB status
Honest status: the running application uses **Python (NumPy/SciPy) for every computation**; the API labels results `python-scipy` / `python-numpy-fft`.
MATLAB reference functions in `matlab/functions` (spectrum, filter design) mirror the Python conventions and have a test script, but they have **not been executed** by the author of this scaffold.
Verification steps for you (PowerShell): `matlab -batch "ver"`, `license('test','Signal_Toolbox')`, then run `matlab/tests/run_tests.m`.
Only after `matlab.engine` imports in your Python version should an engine adapter be added to `backend/app/matlab/`.
