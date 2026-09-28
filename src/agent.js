import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const ai = new GoogleGenAI({
  apiKey: config.apiKey,
});

const tools = [
  {
    functionDeclarations: [
      {
        name: 'read_file',
        description: 'Read a text file from the current project.',
        parameters: {
          type: 'OBJECT',
          properties: {
            file_path: {
              type: 'STRING',
              description: 'Path relative to the current project.',
            },
          },
          required: ['file_path'],
        },
      },
      {
        name: 'write_file',
        description: 'Create or overwrite a text file in the current project.',
        parameters: {
          type: 'OBJECT',
          properties: {
            file_path: {
              type: 'STRING',
              description: 'Path relative to the current project.',
            },
            content: {
              type: 'STRING',
              description: 'Complete file contents.',
            },
          },
          required: ['file_path', 'content'],
        },
      },
      {
        name: 'run_shell',
        description: 'Run a shell command in the current project.',
        parameters: {
          type: 'OBJECT',
          properties: {
            command: {
              type: 'STRING',
              description: 'Shell command to execute.',
            },
          },
          required: ['command'],
        },
      },
    ],
  },
];

function safePath(filePath) {
  const root = process.cwd();
  const resolved = path.resolve(root, filePath);

  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Path escapes project directory.');
  }

  return resolved;
}

async function executeTool(name, args) {
  switch (name) {
    case 'read_file': {
      const file = safePath(args.file_path);
      const content = await fs.readFile(file, 'utf8');

      return {
        success: true,
        file_path: args.file_path,
        content,
      };
    }

    case 'write_file': {
      const file = safePath(args.file_path);

      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, args.content, 'utf8');

      return {
        success: true,
        file_path: args.file_path,
        message: 'File written successfully.',
      };
    }

    case 'run_shell': {
      console.log(`\n[agent] $ ${args.command}`);

      const { stdout, stderr } = await execAsync(args.command, {
        cwd: process.cwd(),
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 10,
      });

      return {
        success: true,
        stdout,
        stderr,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function runAgent(userMessage) {
  const contents = [
    {
      role: 'user',
      parts: [{ text: userMessage }],
    },
  ];

  while (true) {
    const response = await ai.models.generateContent({
      model: config.model,
      contents,
      config: {
        tools,
        systemInstruction: `
You are an autonomous coding agent.

You operate inside the user's current project directory.

Your job is to modify and test software.

Rules:
- Inspect existing files before modifying them when necessary.
- Use tools instead of pretending you changed files.
- Make the smallest reasonable changes.
- Run tests or relevant commands after changes.
- If a command fails, diagnose and fix the problem.
- Continue working until the user's request is actually completed.
- Never claim something was done unless the tool result confirms it.
`,
      },
    });

    const candidate = response.candidates?.[0];

    if (!candidate) {
      throw new Error('Gemini returned no candidate.');
    }

    const parts = candidate.content?.parts || [];

    contents.push(candidate.content);

    const functionCalls = parts.filter(
      (part) => part.functionCall
    );

    if (functionCalls.length === 0) {
      const text = parts
        .filter((part) => part.text)
        .map((part) => part.text)
        .join('');

      return text;
    }

    const functionResponses = [];

    for (const part of functionCalls) {
      const call = part.functionCall;

      console.log(`[tool] ${call.name}`);

      try {
        const result = await executeTool(
          call.name,
          call.args || {}
        );

        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: result,
          },
        });
      } catch (error) {
        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: {
              success: false,
              error: error.message,
            },
          },
        });
      }
    }

    contents.push({
      role: 'user',
      parts: functionResponses,
    });
  }
}
