import readline from 'node:readline';
import { runAgent } from './agent.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log(`
Coding Agent
============

Current project:
${process.cwd()}

Type your request.
Type "exit" to quit.
`);

function ask() {
  rl.question('\n> ', async (input) => {
    if (input.trim().toLowerCase() === 'exit') {
      rl.close();
      return;
    }

    if (!input.trim()) {
      ask();
      return;
    }

    try {
      const result = await runAgent(input);

      console.log('\n' + result);
    } catch (error) {
      console.error('\nAgent error:', error.message);
    }

    ask();
  });
}

ask();
