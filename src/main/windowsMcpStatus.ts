import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export async function isWindowsMcpRunning(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      // More robust WMI query without spinning up powershell, and escaping to avoid matching the query itself.
      // `wmic process where "commandline like '%windows-mcp%' and name!='wmic.exe'" get processid`
      const { stdout } = await execAsync('wmic process where "commandline like \'%windows-mcp%\' and name!=\'wmic.exe\'" get processid', { timeout: 5000 });
      const lines = stdout.trim().split('\n').filter(l => l.trim() !== '');
      return lines.length > 1; // First line is "ProcessId"
    } else {
      const { stdout } = await execAsync('ps aux', { timeout: 5000 });
      const lines = stdout.trim().split('\n');
      return lines.some(line => line.includes('windows-mcp') && !line.includes('grep'));
    }
  } catch {
    return false;
  }
}
