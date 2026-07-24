import readAgentsPlaybook from '../../utils/agentsPlaybook';

describe('readAgentsPlaybook', () => {
  it('returns the packaged AGENTS.md playbook', () => {
    const playbook = readAgentsPlaybook();
    expect(playbook).toContain('# ts-migrate agent playbook');
    // The facts agents most commonly get wrong must stay documented.
    expect(playbook).toContain('-p @obiemunoz/ts-migrate');
    expect(playbook).toContain('--yes');
    expect(playbook).toContain('--no-commit');
    expect(playbook).toContain('--blame-ignore-revs');
    expect(playbook).toContain('reignore');
    expect(playbook).toContain('ts-migrate report <folder>');
    expect(playbook).toContain('.ts-migrate-baseline.json');
    expect(playbook).toContain('--jsonSummary');
    expect(playbook).toContain('--dry-run');
  });
});
