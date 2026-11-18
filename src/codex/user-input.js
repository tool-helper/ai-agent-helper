import { createInterface } from 'node:readline';
import { select, isCancel } from '@clack/prompts';

export async function* proxyAddresses() {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = '请输入代理地址（如 http://127.0.0.1:7890，回车取消）> ';
  try {
    process.stdout.write(prompt);
    for await (const line of input) {
      if (!line.trim()) return;
      yield line.trim();
      process.stdout.write(prompt);
    }
  } finally {
    input.close();
  }
}

export async function selectItem(message, choices) {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const answer = await select({ message, options: choices.map(({ title, value }) => ({ label: title, value })) });
    return isCancel(answer) ? undefined : answer;
  }

  // Keep numbered selections available to scripts that pipe input.
  console.log(message);
  choices.forEach(({ title }, index) => console.log(`  ${index + 1}. ${title}`));
  const input = createInterface({ input: process.stdin, output: process.stdout });
  input.setPrompt('请选择编号（q 退出）> ');
  try {
    input.prompt();
    for await (const line of input) {
      const answer = line.trim();
      if (/^q$/i.test(answer)) return;
      if (/^[1-9]\d*$/.test(answer) && Number(answer) <= choices.length) {
        return choices[Number(answer) - 1].value;
      }
      console.log(`请输入 1 到 ${choices.length} 之间的编号。`);
      input.prompt();
    }
  } finally {
    input.close();
  }
}
