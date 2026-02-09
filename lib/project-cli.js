function parseMetadataOption(value) {
  if (typeof value !== 'string') {
    throw new Error('Metadata must be provided as key=value');
  }

  const trimmed = value.trim();
  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex === -1) {
    throw new Error('Metadata entries must use the key=value format');
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  const metaValue = trimmed.slice(separatorIndex + 1).trim();

  if (!key) {
    throw new Error('Metadata key cannot be empty');
  }

  return { key, value: metaValue };
}

function buildMetadataObject(entries = []) {
  const metadata = {};
  for (const entry of entries) {
    const { key, value } = parseMetadataOption(entry);
    metadata[key] = value;
  }
  return metadata;
}

function parseRepoOption(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    throw new Error('Repo JSON payload is required');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (err) {
    throw new Error(`Invalid JSON for --repo: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Repo payload must be a JSON object');
  }

  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  if (!name) {
    throw new Error('Repo payload must include a non-empty "name" field');
  }

  const repo = { name };
  if (typeof parsed.path === 'string') {
    const trimmedPath = parsed.path.trim();
    if (trimmedPath) repo.path = trimmedPath;
  }
  if (typeof parsed.git_url === 'string') {
    const trimmedUrl = parsed.git_url.trim();
    if (trimmedUrl) repo.git_url = trimmedUrl;
  }
  if (typeof parsed.notes === 'string') {
    const trimmedNotes = parsed.notes.trim();
    if (trimmedNotes) repo.notes = trimmedNotes;
  }

  return repo;
}

function collectProjectFlags(argv = []) {
  const parsed = {
    name: null,
    slug: null,
    description: null,
    ci_cd_info: null,
    metadata: [],
    repos: [],
    workflow_id: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case '--name':
      case '-n':
        parsed.name = value;
        i++;
        break;
      case '--slug':
        parsed.slug = value;
        i++;
        break;
      case '--description':
      case '--desc':
        parsed.description = value;
        i++;
        break;
      case '--ci':
      case '--ci-info':
        parsed.ci_cd_info = value;
        i++;
        break;
      case '--metadata':
        if (typeof value === 'undefined') {
          throw new Error('Missing value for --metadata');
        }
        parsed.metadata.push(value);
        i++;
        break;
      case '--repo':
        if (typeof value === 'undefined') {
          throw new Error('Missing JSON payload for --repo');
        }
        parsed.repos.push(parseRepoOption(value));
        i++;
        break;
      case '--workflow':
      case '--workflow-id':
        if (typeof value === 'undefined') {
          throw new Error('Missing value for --workflow-id');
        }
        parsed.workflow_id = value;
        i++;
        break;
      default:
        throw new Error(`Unknown option for project command: ${arg}`);
    }
  }

  return parsed;
}

function buildProjectBody(flags = {}) {
  const body = {};
  if (flags.name?.trim()) {
    body.name = flags.name.trim();
  }
  if (flags.slug?.trim()) {
    body.slug = flags.slug.trim();
  }
  if (flags.description?.trim()) {
    body.description = flags.description.trim();
  }
  if (flags.ci_cd_info?.trim()) {
    body.ci_cd_info = flags.ci_cd_info.trim();
  }
  if (flags.metadata?.length) {
    body.metadata = buildMetadataObject(flags.metadata);
  }
  if (flags.repos?.length) {
    body.repos = flags.repos;
  }
  if (flags.workflow_id?.trim()) {
    body.workflow_id = flags.workflow_id.trim();
  }
  return body;
}

async function createProject(flags, cloudRequestFn) {
  if (!flags?.name?.trim()) {
    throw new Error('Project name is required (--name)');
  }
  if (typeof cloudRequestFn !== 'function') {
    throw new Error('cloudRequest function is required to create a project');
  }
  const body = buildProjectBody(flags);
  return cloudRequestFn('POST', '/api/projects', body);
}

module.exports = {
  parseMetadataOption,
  buildMetadataObject,
  parseRepoOption,
  collectProjectFlags,
  buildProjectBody,
  createProject,
};
