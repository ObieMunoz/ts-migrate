import fs from 'fs';
import path from 'path';
import ensureAliasDeclarations from '../../utils/aliasDeclarations';
import { createDir, deleteDir } from '../test-utils';

describe('ensureAliasDeclarations', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = createDir();
    fs.writeFileSync(path.resolve(rootDir, 'tsconfig.json'), '{}');
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  const generatedFile = () => path.join(rootDir, 'ts-migrate-aliases.d.ts');

  it('writes the requested aliases where the tsconfig picks them up', () => {
    const written = ensureAliasDeclarations({
      rootDir,
      anyAlias: '$TSFixMe',
      anyFunctionAlias: '$TSFixMeFunction',
    });
    expect(written?.filePath).toBe(generatedFile());
    const text = fs.readFileSync(generatedFile(), 'utf-8');
    expect(text).toBe(written?.text);
    expect(text).toContain('type $TSFixMe = any;');
    expect(text).toContain('type $TSFixMeFunction = (...args: any[]) => any;');
  });

  it('computes the file without writing it on a dry run', () => {
    const written = ensureAliasDeclarations({
      rootDir,
      anyAlias: '$TSFixMe',
      dryRun: true,
    });
    expect(written?.filePath).toBe(generatedFile());
    expect(written?.text).toContain('type $TSFixMe = any;');
    expect(fs.existsSync(generatedFile())).toBe(false);
  });

  it('returns null when no alias is requested', () => {
    expect(ensureAliasDeclarations({ rootDir })).toBeNull();
    expect(fs.existsSync(generatedFile())).toBe(false);
  });

  it('omits aliases an included .d.ts file already declares', () => {
    fs.writeFileSync(path.resolve(rootDir, 'globals.d.ts'), 'declare type $TSFixMe = any;\n');
    const written = ensureAliasDeclarations({
      rootDir,
      anyAlias: '$TSFixMe',
      anyFunctionAlias: '$TSFixMeFunction',
    });
    const text = fs.readFileSync(written?.filePath as string, 'utf-8');
    expect(text).not.toContain('type $TSFixMe = any;');
    expect(text).toContain('type $TSFixMeFunction = (...args: any[]) => any;');
  });

  it('does not treat a declared $TSFixMeFunction as covering $TSFixMe', () => {
    fs.writeFileSync(
      path.resolve(rootDir, 'globals.d.ts'),
      'type $TSFixMeFunction = (...args: any[]) => any;\n',
    );
    const written = ensureAliasDeclarations({
      rootDir,
      anyAlias: '$TSFixMe',
      anyFunctionAlias: '$TSFixMeFunction',
    });
    const text = fs.readFileSync(written?.filePath as string, 'utf-8');
    expect(text).toContain('type $TSFixMe = any;');
    expect(text).not.toContain('$TSFixMeFunction');
  });

  it('writes nothing when every alias is already declared', () => {
    fs.writeFileSync(
      path.resolve(rootDir, 'globals.d.ts'),
      'type $TSFixMe = any;\ntype $TSFixMeFunction = (...args: any[]) => any;\n',
    );
    expect(
      ensureAliasDeclarations({
        rootDir,
        anyAlias: '$TSFixMe',
        anyFunctionAlias: '$TSFixMeFunction',
      }),
    ).toBeNull();
    expect(fs.existsSync(generatedFile())).toBe(false);
  });

  it('finds declarations pulled in from outside rootDir by the tsconfig include', () => {
    const projDir = path.join(rootDir, 'proj');
    fs.mkdirSync(projDir);
    fs.mkdirSync(path.join(rootDir, 'shared'));
    fs.writeFileSync(
      path.join(rootDir, 'shared', 'reactTypes.d.ts'),
      'declare type $TSFixMe = any;\ndeclare type $TSFixMeFunction = (...args: any[]) => any;\n',
    );
    fs.writeFileSync(
      path.join(projDir, 'tsconfig.json'),
      JSON.stringify({ include: ['.', '../shared'] }),
    );
    expect(
      ensureAliasDeclarations({
        rootDir: projDir,
        anyAlias: '$TSFixMe',
        anyFunctionAlias: '$TSFixMeFunction',
      }),
    ).toBeNull();
    expect(fs.existsSync(path.join(projDir, 'ts-migrate-aliases.d.ts'))).toBe(false);
  });

  it('keeps an existing generated file as is', () => {
    fs.writeFileSync(generatedFile(), 'type $TSFixMe = unknown;\n');
    expect(
      ensureAliasDeclarations({ rootDir, anyAlias: '$TSFixMe' }),
    ).toBeNull();
    expect(fs.readFileSync(generatedFile(), 'utf-8')).toBe('type $TSFixMe = unknown;\n');
  });

  it('still writes when there is no tsconfig to scan', () => {
    fs.unlinkSync(path.resolve(rootDir, 'tsconfig.json'));
    const written = ensureAliasDeclarations({ rootDir, anyAlias: '$TSFixMe' });
    expect(written?.filePath).toBe(generatedFile());
    expect(fs.readFileSync(generatedFile(), 'utf-8')).toContain('type $TSFixMe = any;');
  });
});
