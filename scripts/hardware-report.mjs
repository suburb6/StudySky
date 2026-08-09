import os from 'node:os';
import { promises as filesystem } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const storageRoot = process.env.STORAGE_ROOT || process.cwd();
const memoryGb = os.totalmem() / 1024 ** 3;
const freeMemoryGb = os.freemem() / 1024 ** 3;
const disk = await filesystem.statfs(storageRoot).catch(() => null);
const gpu = await detectGpu();

const report = {
  generatedAt: new Date().toISOString(),
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: {
    model: os.cpus()[0]?.model ?? 'Unknown',
    logicalCores: os.cpus().length
  },
  memory: {
    totalGb: round(memoryGb),
    currentlyAvailableGb: round(freeMemoryGb)
  },
  disk: disk
    ? {
        checkedPath: storageRoot,
        totalGb: round((disk.blocks * disk.bsize) / 1024 ** 3),
        availableGb: round((disk.bavail * disk.bsize) / 1024 ** 3)
      }
    : { checkedPath: storageRoot, unavailable: true },
  gpu,
  recommendation: recommendation(memoryGb, gpu.detected),
  caveat:
    'This is a capacity estimate, not a performance claim. Benchmark the selected quantisation and context length on the VPS before enabling document analysis.'
};

console.log(JSON.stringify(report, null, 2));

async function detectGpu() {
  try {
    const { stdout } = await run(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 5000 }
    );
    const devices = stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [name, memoryMb] = line.split(',').map((value) => value.trim());
        return { name, memoryMb: Number(memoryMb) || null };
      });
    return { detected: devices.length > 0, type: 'NVIDIA', devices };
  } catch {
    return {
      detected: false,
      note: 'No NVIDIA GPU was detected with nvidia-smi. Other accelerators are not claimed.'
    };
  }
}

function recommendation(totalMemoryGb, gpuDetected) {
  if (totalMemoryGb < 4) {
    return 'Keep AI disabled. OCR and the core study system are the practical baseline.';
  }
  if (totalMemoryGb < 8) {
    return 'Start with a current 0.5B–1.5B quantised model and a short context. Expect limited reasoning.';
  }
  if (totalMemoryGb < 16) {
    return 'A quantised 1.5B–4B model may be practical. Test latency and leave memory for PostgreSQL and OCR.';
  }
  return gpuDetected
    ? 'Small-to-medium quantised models may be practical; benchmark CPU/GPU offload and concurrent OCR.'
    : 'A quantised 4B–8B model may fit, but CPU latency can still be high. Benchmark before relying on it.';
}

function round(value) {
  return Math.round(value * 100) / 100;
}
