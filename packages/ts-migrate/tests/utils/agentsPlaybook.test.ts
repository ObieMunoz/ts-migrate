import readAgentsPlaybook from '../../utils/agentsPlaybook';

describe('readAgentsPlaybook', () => {
  it('returns the packaged AGENTS.md playbook', () => {
    const playbook = readAgentsPlaybook();
    expect(playbook).toContain('# ts-migrate agent playbook');
    // The facts agents most commonly get wrong must stay documented.
    expect(playbook).toContain('-p @obiemunoz/ts-migrate');
    expect(playbook).toContain('--yes');
    expect(playbook).toContain('--commit=false');
    expect(playbook).toContain('--blameIgnoreRevs');
    expect(playbook).toContain('reignore');
    expect(playbook).toContain('ts-migrate report <folder>');
    expect(playbook).toContain('.ts-migrate-baseline.json');
    expect(playbook).toContain('--jsonSummary');
    expect(playbook).toContain('--dryRun');
    // The playbook is what an agent runs from, so the one spelling it is to
    // write flags in, and the config file, both have to be in it.
    expect(playbook).toContain('camelCase');
    expect(playbook).toContain('ts-migrate.config.json');
  });
});
