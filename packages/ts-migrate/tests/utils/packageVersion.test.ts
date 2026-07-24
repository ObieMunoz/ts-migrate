import fs from 'fs';
import path from 'path';
import packageVersion from '../../utils/packageVersion';

describe('packageVersion', () => {
  it('reports the version from package.json', () => {
    const { version } = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
    );
    expect(packageVersion()).toBe(version);
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
