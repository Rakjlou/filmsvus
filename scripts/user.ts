import { emitKeypressEvents } from 'node:readline';
import { openDatabase } from '../server/db/index.ts';
import { addUser, changePassword, listUsers, removeUser, validateUsername, UserError } from '../server/services/users.ts';

async function readHidden(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode(false); process.stdin.pause(); process.stderr.write('\n');
    };
    const onKey = (text: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') { cleanup(); reject(new UserError('Saisie annulée.')); }
      else if (key.name === 'return' || key.name === 'enter') { cleanup(); resolve(value); }
      else if (key.name === 'backspace') value = [...value].slice(0, -1).join('');
      else if (text && !key.ctrl && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    };
    process.stdin.on('keypress', onKey);
  });
}
async function readPassword() {
  if (!process.stdin.isTTY) {
    // Stop at the first line; don't wait for EOF from a long-lived input pipe.
    let value = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      value += chunk;
      if (value.includes('\n')) break;
    }
    return value.split('\n')[0]!.replace(/\r$/, '');
  }
  const password = await readHidden('Mot de passe : ');
  if (password !== await readHidden('Répéter le mot de passe : ')) throw new UserError('Les mots de passe diffèrent.');
  return password;
}
async function main(args: string[]) {
  const [command, username] = args;
  if (!(command === 'list' && args.length === 1 || ['add', 'passwd', 'remove'].includes(command ?? '') && args.length === 2)) {
    throw new UserError('Usage : npm run user -- {add <nom>|passwd <nom>|remove <nom>|list}. Aucun mot de passe en argument.');
  }
  if (command === 'add') validateUsername(username!);
  // Validate/read the password before opening the DB; invalid invocations change nothing.
  const password = command === 'add' || command === 'passwd' ? await readPassword() : undefined;
  const db = openDatabase();
  try {
    switch (command) {
      case 'list': for (const user of listUsers(db)) console.log(`${user.username}\t${user.created_at}`); break;
      case 'add': await addUser(db, username!, password!); console.log('Compte créé.'); break;
      case 'passwd': await changePassword(db, username!, password!); console.log('Mot de passe modifié. (sessions révoquées)'); break;
      case 'remove': removeUser(db, username!); console.log('Compte supprimé.'); break;
    }
  } finally { db.close(); }
}
if (import.meta.main) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    // Never print a SQLite error (it can contain data); only known validation messages.
    console.error(error instanceof UserError ? error.message
      : 'Impossible de modifier le compte (identifiant déjà utilisé ou base indisponible).');
    process.exitCode = 1;
  }
}
