// Local, regex-based skill / seniority / domain / years / title extraction.
// No external APIs. All matching is word-boundary or pattern-based against the
// canonical SKILLS dictionary below.

// canonical name → regexes that should match in any text
// Each regex must be authored to avoid embedded matches like "ai" in "main".
const SKILLS = [
  // Languages
  ['Python',       [/\bpython\b/i]],
  ['Java',         [/\bjava\b(?!script)/i]],
  ['JavaScript',   [/\bjavascript\b/i, /\bjs\b(?=[\s,/])/i, /\becmascript\b/i]],
  ['TypeScript',   [/\btypescript\b/i, /\bts\b(?=[\s,/])/i]],
  ['Go',           [/\bgolang\b/i, /\bgo\s+(?:lang|programming|developer|engineer)\b/i]],
  ['Rust',         [/\brust\b/i]],
  ['C++',          [/\bc\+\+/i, /\bcpp\b/i]],
  ['C#',           [/\bc#/i, /\bdotnet\b/i, /\b\.net\b/i]],
  ['C',            [/\b(?:ansi\s)?c\s+(?:programming|language)\b/i]],
  ['Ruby',         [/\bruby\b/i, /\brails\b/i]],
  ['PHP',          [/\bphp\b/i]],
  ['Scala',        [/\bscala\b/i]],
  ['Swift',        [/\bswift\b/i]],
  ['Kotlin',       [/\bkotlin\b/i]],
  ['R',            [/\bR\s+programming\b/, /\bR\s+language\b/]],
  ['Perl',         [/\bperl\b/i]],
  ['Bash',         [/\bbash\b/i, /\bshell\s+scripting\b/i]],
  ['PowerShell',   [/\bpowershell\b/i]],
  ['SQL',          [/\bsql\b/i]],
  ['HTML',         [/\bhtml5?\b/i]],
  ['CSS',          [/\bcss3?\b/i, /\bsass\b/i, /\bscss\b/i, /\bless\b(?=\s+css)/i]],

  // Web frontend frameworks
  ['React',        [/\breact(?:\.?js)?\b/i, /\breactjs\b/i]],
  ['Angular',      [/\bangular\b/i]],
  ['Vue',          [/\bvue(?:\.?js)?\b/i]],
  ['Next.js',      [/\bnext\.?js\b/i]],
  ['Nuxt',         [/\bnuxt(?:\.?js)?\b/i]],
  ['Redux',        [/\bredux\b/i]],
  ['jQuery',       [/\bjquery\b/i]],
  ['Bootstrap',    [/\bbootstrap\b/i]],
  ['Tailwind',     [/\btailwind\b/i]],

  // Backend frameworks
  ['Spring Boot',  [/\bspring\s*boot\b/i, /\bspring(?:\s+framework)?\b/i, /\bspring\s+mvc\b/i]],
  ['Django',       [/\bdjango\b/i]],
  ['Flask',        [/\bflask\b/i]],
  ['FastAPI',      [/\bfastapi\b/i]],
  ['Express',      [/\bexpress(?:\.?js)?\b/i]],
  ['Node.js',      [/\bnode(?:\.?js)?\b/i, /\bnodejs\b/i]],
  ['Laravel',      [/\blaravel\b/i]],
  ['ASP.NET',      [/\basp\.?net\b/i]],
  ['Hibernate',    [/\bhibernate\b/i]],
  ['JPA',          [/\bjpa\b/i]],

  // Mobile
  ['iOS',          [/\bios\s+(?:dev|engineer|developer|app)/i, /\bswiftui\b/i]],
  ['Android',      [/\bandroid\s+(?:dev|engineer|developer|app)/i, /\bjetpack\b/i]],
  ['React Native', [/\breact\s+native\b/i]],
  ['Flutter',      [/\bflutter\b/i]],

  // Cloud
  ['AWS',          [/\baws\b/i, /\bamazon\s+web\s+services\b/i]],
  ['Azure',        [/\bazure\b/i, /\bms\s+azure\b/i]],
  ['GCP',          [/\bgcp\b/i, /\bgoogle\s+cloud\b/i]],
  ['Oracle Cloud', [/\boracle\s+cloud\b/i, /\boci\b/i]],
  ['Lambda',       [/\baws\s+lambda\b/i, /\blambda\s+function\b/i]],
  ['EC2',          [/\bec2\b/i]],
  ['S3',           [/\baws\s+s3\b/i, /\bs3\s+bucket\b/i]],
  ['CloudFormation', [/\bcloudformation\b/i]],
  ['SageMaker',    [/\bsagemaker\b/i]],

  // DevOps / Infra
  ['Docker',       [/\bdocker\b/i, /\bcontainerization\b/i]],
  ['Kubernetes',   [/\bkubernetes\b/i, /\bk8s\b/i]],
  ['Helm',         [/\bhelm\s+chart\b/i, /\bhelm\b/i]],
  ['Terraform',    [/\bterraform\b/i]],
  ['Ansible',      [/\bansible\b/i]],
  ['Jenkins',      [/\bjenkins\b/i]],
  ['CircleCI',     [/\bcircle\s*ci\b/i]],
  ['GitHub Actions',[/\bgithub\s+actions\b/i]],
  ['GitLab CI',    [/\bgitlab\s+ci\b/i]],
  ['ArgoCD',       [/\bargocd\b/i, /\bargo\s+cd\b/i]],
  ['Prometheus',   [/\bprometheus\b/i]],
  ['Grafana',      [/\bgrafana\b/i]],
  ['ELK',          [/\belk\s+stack\b/i, /\belasticsearch\b/i, /\bkibana\b/i, /\blogstash\b/i]],
  ['Splunk',       [/\bsplunk\b/i]],
  ['Datadog',      [/\bdatadog\b/i]],
  ['Nginx',        [/\bnginx\b/i]],
  ['Apache',       [/\bapache\s+(?:http|web|server)\b/i]],
  ['CI/CD',        [/\bci\/cd\b/i, /\bcontinuous\s+(?:integration|delivery|deployment)\b/i]],
  ['Linux',        [/\blinux\b/i, /\bunix\b/i]],
  ['Git',          [/\bgit(?:hub|lab|\b)/i]],

  // Databases
  ['PostgreSQL',   [/\bpostgres(?:ql)?\b/i]],
  ['MySQL',        [/\bmysql\b/i]],
  ['SQL Server',   [/\bsql\s+server\b/i, /\bmssql\b/i, /\bt-sql\b/i]],
  ['Oracle DB',    [/\boracle\s+(?:database|db|sql)\b/i, /\bpl\/sql\b/i]],
  ['MongoDB',      [/\bmongodb\b/i, /\bmongo\b/i]],
  ['Redis',        [/\bredis\b/i]],
  ['Cassandra',    [/\bcassandra\b/i]],
  ['DynamoDB',     [/\bdynamodb\b/i]],
  ['Snowflake',    [/\bsnowflake\b/i]],
  ['BigQuery',     [/\bbigquery\b/i]],
  ['Redshift',     [/\bredshift\b/i]],
  ['CockroachDB',  [/\bcockroach(?:db)?\b/i]],

  // Data / Analytics
  ['Spark',        [/\bspark\b/i, /\bpyspark\b/i]],
  ['Hadoop',       [/\bhadoop\b/i, /\bhdfs\b/i, /\byarn\b/i, /\bmapreduce\b/i]],
  ['Kafka',        [/\bkafka\b/i]],
  ['Airflow',      [/\bairflow\b/i]],
  ['dbt',          [/\bdbt\b/i]],
  ['Tableau',      [/\btableau\b/i]],
  ['Power BI',     [/\bpower\s*bi\b/i]],
  ['Looker',       [/\blooker\b/i]],
  ['Databricks',   [/\bdatabricks\b/i]],
  ['ETL',          [/\betl\b/i, /\bdata\s+pipeline\b/i]],
  ['Pandas',       [/\bpandas\b/i]],
  ['NumPy',        [/\bnumpy\b/i]],
  ['Excel',        [/\bms\s+excel\b/i, /\bmicrosoft\s+excel\b/i, /\badvanced\s+excel\b/i]],

  // ML / AI
  ['Machine Learning', [/\bmachine\s+learning\b/i, /\bml\b(?=\s+(?:eng|model|pipeline))/i]],
  ['Deep Learning',[/\bdeep\s+learning\b/i]],
  ['TensorFlow',   [/\btensorflow\b/i]],
  ['PyTorch',      [/\bpytorch\b/i]],
  ['Keras',        [/\bkeras\b/i]],
  ['scikit-learn', [/\bscikit-learn\b/i, /\bsklearn\b/i]],
  ['NLP',          [/\bnlp\b/i, /\bnatural\s+language\s+processing\b/i]],
  ['Computer Vision',[/\bcomputer\s+vision\b/i, /\bopencv\b/i]],
  ['LLM',          [/\bllm\b/i, /\blarge\s+language\s+model\b/i, /\bgpt\b/i, /\bgenerative\s+ai\b/i]],
  ['Hugging Face', [/\bhugging\s+face\b/i]],

  // APIs / protocols
  ['REST',         [/\brest(?:ful)?\s+api\b/i, /\brest\b/i]],
  ['GraphQL',      [/\bgraphql\b/i]],
  ['gRPC',         [/\bgrpc\b/i]],
  ['OAuth',        [/\boauth\b/i]],
  ['JWT',          [/\bjwt\b/i, /\bjson\s+web\s+token\b/i]],
  ['WebSocket',    [/\bwebsocket\b/i, /\bsocket\.io\b/i]],
  ['Microservices',[/\bmicroservices?\b/i]],
  ['SOA',          [/\bsoa\b/i, /\bservice-oriented\b/i]],
  ['SAML',         [/\bsaml\b/i]],
  ['SSO',          [/\bsso\b/i, /\bsingle\s+sign-on\b/i]],

  // Testing
  ['Jest',         [/\bjest\b/i]],
  ['Mocha',        [/\bmocha\b/i]],
  ['Pytest',       [/\bpytest\b/i]],
  ['JUnit',        [/\bjunit\b/i]],
  ['Selenium',     [/\bselenium\b/i]],
  ['Cypress',      [/\bcypress\b/i]],
  ['Playwright',   [/\bplaywright\b/i]],
  ['TDD',          [/\btdd\b/i, /\btest-driven\s+development\b/i]],
  ['BDD',          [/\bbdd\b/i, /\bbehavior-driven\b/i]],

  // Enterprise / ERP
  ['Salesforce',   [/\bsalesforce\b/i, /\bapex\b/i, /\bsfdc\b/i, /\bvisualforce\b/i, /\blightning\s+(?:component|web)\b/i]],
  ['ServiceNow',   [/\bservicenow\b/i]],
  ['SharePoint',   [/\bsharepoint\b/i]],
  ['SAP',          [/\bsap\s+(?:erp|abap|hana|fiori|s\/4)\b/i]],
  ['Workday',      [/\bworkday\b/i]],
  ['PeopleSoft',   [/\bpeoplesoft\b/i]],

  // Healthcare-specific
  ['Epic',         [/\bepic\s+(?:emr|systems|ehr)\b/i, /\bepic\s+(?:iris|cache|chronicles)\b/i]],
  ['Cerner',       [/\bcerner\b/i]],
  ['HL7',          [/\bhl7\b/i]],
  ['FHIR',         [/\bfhir\b/i]],
  ['HIPAA',        [/\bhipaa\b/i]],

  // Methodologies & soft tech
  ['Agile',        [/\bagile\b/i, /\bscrum\b/i, /\bkanban\b/i]],
  ['SAFe',         [/\bsafe\s+agile\b/i]],
  ['JIRA',         [/\bjira\b/i]],
  ['Confluence',   [/\bconfluence\b/i]],

  // Specialty
  ['Bioinformatics',[/\bbioinformatics\b/i, /\bcomputational\s+biology\b/i, /\bgenomics\b/i]],
  ['GIS',          [/\bgis\b/i, /\bgeospatial\b/i, /\barcgis\b/i, /\bqgis\b/i, /\bpostgis\b/i]],
  ['Blockchain',   [/\bblockchain\b/i, /\bsmart\s+contract\b/i, /\bsolidity\b/i, /\bweb3\b/i]],
  ['IoT',          [/\biot\b/i, /\binternet\s+of\s+things\b/i]],
  ['Embedded',     [/\bembedded\s+(?:systems|software|engineer)\b/i, /\bfirmware\b/i, /\brtos\b/i]],
  ['Robotics',     [/\brobotics\b/i, /\bros\b(?=\s+(?:framework|robot))/i]],
];

// Map common job-title patterns to their canonical implied skills.
// Used both for resume title parsing AND for inferring JD skills from a short job title.
const TITLE_SKILL_MAP = [
  { re: /\bfull\s*[-]?\s*stack\b/i,             titles: ['Full Stack Developer'],   imply: ['JavaScript','HTML','CSS','REST','SQL','Node.js','React'] },
  { re: /\bfrontend|front-end|front\s+end\b/i,  titles: ['Frontend Developer'],     imply: ['JavaScript','HTML','CSS','React'] },
  { re: /\bbackend|back-end|back\s+end\b/i,     titles: ['Backend Developer'],      imply: ['REST','SQL','API'] },
  { re: /\bsoftware\s+engineer\b/i,             titles: ['Software Engineer'],      imply: [] },
  { re: /\bsoftware\s+developer\b/i,            titles: ['Software Developer'],     imply: [] },
  { re: /\bapplication\s+developer\b/i,         titles: ['Application Developer'],  imply: [] },
  { re: /\bjava\s+developer\b/i,                titles: ['Java Developer'],         imply: ['Java','Spring Boot','SQL','REST'] },
  { re: /\bpython\s+developer\b/i,              titles: ['Python Developer'],       imply: ['Python','SQL','REST'] },
  { re: /\bjavascript|node\s+developer\b/i,     titles: ['JavaScript Developer'],   imply: ['JavaScript','Node.js','REST'] },
  { re: /\b\.net\s+developer\b/i,               titles: ['.NET Developer'],         imply: ['C#','ASP.NET','SQL'] },
  { re: /\bdata\s+engineer\b/i,                 titles: ['Data Engineer'],          imply: ['Python','SQL','ETL','Spark','Airflow'] },
  { re: /\bdata\s+scientist\b/i,                titles: ['Data Scientist'],         imply: ['Python','SQL','Machine Learning','Pandas','NumPy'] },
  { re: /\bdata\s+analyst\b/i,                  titles: ['Data Analyst'],           imply: ['SQL','Excel','Tableau','Power BI'] },
  { re: /\bml\s+engineer|machine\s+learning\s+engineer\b/i, titles:['ML Engineer'], imply: ['Python','Machine Learning','TensorFlow','PyTorch'] },
  { re: /\bai\s+engineer|ai\s+developer\b/i,    titles: ['AI Engineer'],            imply: ['Python','Machine Learning','LLM'] },
  { re: /\bdevops\b/i,                          titles: ['DevOps Engineer'],        imply: ['Docker','Kubernetes','CI/CD','Linux','Terraform','AWS'] },
  { re: /\bsite\s+reliability|\bsre\b/i,        titles: ['SRE'],                    imply: ['Linux','Kubernetes','Prometheus','CI/CD'] },
  { re: /\bcloud\s+(engineer|developer|architect)\b/i, titles:['Cloud Engineer'],   imply: ['AWS','Azure','GCP','Terraform'] },
  { re: /\binfrastructure\s+engineer\b/i,       titles: ['Infrastructure Engineer'],imply: ['Linux','Terraform','AWS','Kubernetes'] },
  { re: /\bplatform\s+engineer\b/i,             titles: ['Platform Engineer'],      imply: ['Kubernetes','CI/CD','Linux','Terraform'] },
  { re: /\bsecurity\s+engineer|cybersecurity\s+engineer\b/i, titles:['Security Engineer'], imply:['Security','Linux','SAML','OAuth'] },
  { re: /\bsalesforce\s+(developer|admin|engineer)\b/i, titles:['Salesforce Developer'], imply: ['Salesforce','SQL'] },
  { re: /\bsystems?\s+(administrator|admin|engineer)\b/i, titles:['Systems Administrator'], imply: ['Linux','Bash','Networking'] },
  { re: /\bnetwork\s+engineer\b/i,              titles: ['Network Engineer'],       imply: ['Networking','Linux','TCP/IP'] },
  { re: /\bdatabase\s+(administrator|admin|engineer)\b|\bdba\b/i, titles:['DBA'],   imply: ['SQL','PostgreSQL','MySQL','Oracle DB'] },
  { re: /\bweb\s+developer|web\s+engineer\b/i,  titles: ['Web Developer'],          imply: ['JavaScript','HTML','CSS','REST'] },
  { re: /\bsolutions?\s+architect\b/i,          titles: ['Solutions Architect'],    imply: ['AWS','REST','Microservices'] },
  { re: /\bsoftware\s+architect\b/i,            titles: ['Software Architect'],     imply: ['Microservices','REST'] },
  { re: /\benterprise\s+architect\b/i,          titles: ['Enterprise Architect'],   imply: ['Microservices','REST'] },
  { re: /\bqa\s+(engineer|developer)|test\s+(engineer|developer)|sdet\b/i, titles:['QA Engineer'], imply: ['Selenium','Cypress','Pytest'] },
  { re: /\bembedded\s+(software|engineer)\b/i,  titles: ['Embedded Engineer'],      imply: ['C','C++','Embedded'] },
  { re: /\bfirmware\s+engineer\b/i,             titles: ['Firmware Engineer'],      imply: ['C','Embedded'] },
  { re: /\bgis\s+(developer|analyst)\b/i,       titles: ['GIS Developer'],          imply: ['GIS','SQL','Python'] },
  { re: /\bbioinformatics\b/i,                  titles: ['Bioinformatics Engineer'],imply: ['Bioinformatics','Python','R'] },
  { re: /\bresearch\s+(engineer|software|scientist)\b/i, titles:['Research Engineer'], imply: ['Python'] },
  { re: /\b(staff|principal|distinguished)\s+(engineer|developer)\b/i, titles:['Staff Engineer'], imply: [] },
  { re: /\b(tech|technical)\s+lead\b/i,         titles: ['Tech Lead'],              imply: ['Microservices'] },
  { re: /\b(engineering|software)\s+manager\b/i,titles: ['Engineering Manager'],    imply: ['Agile'] },
  { re: /\b(it|information\s+technology)\s+(manager|analyst)\b/i, titles:['IT Manager'], imply: ['IT'] },
  { re: /\binformation\s+systems\b/i,           titles: ['Information Systems Specialist'], imply: ['SQL'] },
];

const SENIORITY_ORDER = ['junior', 'mid', 'senior', 'lead', 'principal'];

function inferSeniority(text, years) {
  const t = (text || '').toLowerCase();
  if (/\b(principal|distinguished|fellow)\b/.test(t)) return 'principal';
  if (/\b(staff\s+engineer|architect|head\s+of|director\s+of\s+engineering|vp\s+of\s+engineering|cto)\b/.test(t)) return 'lead';
  if (/\b(lead|tech\s+lead|technical\s+lead|engineering\s+manager)\b/.test(t)) return 'lead';
  if (/\b(senior|sr\.?)\b/.test(t)) return 'senior';
  if (/\b(junior|jr\.?|associate|intern|entry[\s-]level|graduate|new\s+grad)\b/.test(t)) return 'junior';
  if (typeof years === 'number') {
    if (years <= 2) return 'junior';
    if (years <= 5) return 'mid';
    if (years <= 9) return 'senior';
    return 'lead';
  }
  return 'mid';
}

function inferYears(text) {
  const m = (text || '').match(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s+of\s+(?:experience|professional)/i)
        || (text || '').match(/(\d{1,2})\.?\d?\s*\+?\s*(?:years?|yrs?)\s+(?:experience|exp)/i)
        || (text || '').match(/over\s+(\d{1,2})\s+years?/i);
  return m ? Math.min(40, parseInt(m[1], 10)) : null;
}

const DOMAIN_PATTERNS = [
  { canonical: 'healthcare', re: /\b(healthcare|hospital|medical|clinical|pharma(?:ceutical)?|patient|emr|ehr|epic|cerner|hipaa|fhir|hl7)\b/i },
  { canonical: 'finance',    re: /\b(financial|finance|fintech|banking|trading|wealth|investment|brokerage|sox|payments?|payroll)\b/i },
  { canonical: 'insurance',  re: /\b(insurance|underwriting|claims|actuarial|reinsurance)\b/i },
  { canonical: 'education',  re: /\b(university|college|academic|education|edtech|student|teacher|coursera)\b/i },
  { canonical: 'government', re: /\b(government|federal|public\s+sector|state\s+of\s+\w+|department\s+of|dod)\b/i },
  { canonical: 'ngo',        re: /\b(non-?profit|ngo|foundation|charit(?:y|able))\b/i },
  { canonical: 'retail',     re: /\b(retail|ecommerce|e-commerce|merchand)/i },
  { canonical: 'telecom',    re: /\b(telecom|telecommunications|carrier|5g|isp\b)/i },
  { canonical: 'media',      re: /\b(media|streaming|publishing|broadcast|content)\b/i },
];

function inferDomains(text) {
  const out = [];
  for (const d of DOMAIN_PATTERNS) if (d.re.test(text || '')) out.push(d.canonical);
  return out;
}

const ADJACENT_DOMAINS = {
  healthcare: ['ngo'],
  finance: ['insurance'],
  insurance: ['finance'],
  education: ['ngo'],
  government: ['ngo'],
  ngo: ['education','healthcare','government'],
  retail: ['media'],
  media: ['retail'],
  telecom: [],
};

// ---- Aliases / synonyms (user-supplied) ----
// Each canonical key has all aliases (including itself) that should match in JD/resume text.
const SKILL_ALIASES = {
  "javascript":                 ["js", "javascript", "node.js", "nodejs", "node"],
  "python":                     ["python", "py"],
  "kubernetes":                 ["kubernetes", "k8s"],
  "postgresql":                 ["postgresql", "postgres", "psql"],
  "machine learning":           ["machine learning", "ml"],
  "artificial intelligence":    ["artificial intelligence", "ai"],
  "amazon web services":        ["aws", "amazon web services"],
  "microsoft azure":            ["azure", "microsoft azure"],
  "google cloud":               ["gcp", "google cloud", "google cloud platform"],
  "continuous integration":     ["ci/cd", "cicd", "continuous integration", "continuous delivery", "continuous deployment"],
  "typescript":                 ["typescript", "ts"],
  "react":                      ["react", "reactjs", "react.js"],
  "vue":                        ["vue", "vuejs", "vue.js"],
  "angular":                    ["angular", "angularjs"],
  "mongodb":                    ["mongodb", "mongo"],
  "elasticsearch":              ["elasticsearch", "elastic", "elk"],
  "docker":                     ["docker", "dockerfile", "containerization"],
  "electronic health record":   ["ehr", "emr", "electronic health record"],
  "epic":                       ["epic", "epic systems"],
  "cerner":                     ["cerner", "oracle health", "oracle cerner"],
  "hl7":                        ["hl7", "hl7 fhir"],
  "salesforce":                 ["salesforce", "sfdc"],
  "sharepoint":                 ["sharepoint", "ms sharepoint"],
};

// Lowercase alias-map key → display name shown in UI/DB.
const ALIAS_DISPLAY = {
  "javascript":               "JavaScript",
  "python":                   "Python",
  "kubernetes":               "Kubernetes",
  "postgresql":               "PostgreSQL",
  "machine learning":         "Machine Learning",
  "artificial intelligence":  "AI",
  "amazon web services":      "AWS",
  "microsoft azure":          "Azure",
  "google cloud":             "GCP",
  "continuous integration":   "CI/CD",
  "typescript":               "TypeScript",
  "react":                    "React",
  "vue":                      "Vue",
  "angular":                  "Angular",
  "mongodb":                  "MongoDB",
  "elasticsearch":            "Elasticsearch",
  "docker":                   "Docker",
  "electronic health record": "EHR",
  "epic":                     "Epic",
  "cerner":                   "Cerner",
  "hl7":                      "HL7",
  "salesforce":               "Salesforce",
  "sharepoint":               "SharePoint",
};

// Old canonical → new canonical. Forces dedup when my SKILLS dict and the alias
// map would otherwise produce two names for the same concept (per user's "no duplicates" rule).
const CANONICAL_REWRITE = {
  "Node.js": "JavaScript",      // user: node.js is an alias of javascript
  "ELK":     "Elasticsearch",   // user: elk → elasticsearch
};

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// Word-boundary match for short tokens: requires non-alphanumeric (or string edge) on both sides.
function aliasMatches(text, alias) {
  return new RegExp(`(?:^|[^a-z0-9])${escapeRe(alias.toLowerCase())}(?:[^a-z0-9]|$)`, 'i').test(text);
}

function extractSkills(text) {
  const found = new Set();
  // 1. User-supplied alias map (canonical → list of aliases). If any alias hits, add the display name.
  for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
    if (aliases.some(a => aliasMatches(text, a))) {
      found.add(ALIAS_DISPLAY[canonical] || canonical);
    }
  }
  // 2. Existing SKILLS regex patterns (for the long tail not in the alias map).
  for (const [canonical, regexes] of SKILLS) {
    if (regexes.some(r => r.test(text))) {
      found.add(CANONICAL_REWRITE[canonical] || canonical);
    }
  }
  // 3. Title-inferred implied skills.
  for (const t of TITLE_SKILL_MAP) {
    if (t.re.test(text)) for (const s of t.imply) {
      found.add(CANONICAL_REWRITE[s] || s);
    }
  }
  return Array.from(found).sort();
}

function extractTitles(text) {
  const out = new Set();
  for (const t of TITLE_SKILL_MAP) {
    if (t.re.test(text)) for (const title of t.titles) out.add(title);
  }
  return Array.from(out).sort();
}

// Parse a resume's raw text into structured data.
function parseResume(text) {
  const skills = extractSkills(text);
  const titles = extractTitles(text);
  const years = inferYears(text);
  const seniority = inferSeniority(text, years);
  const domains = inferDomains(text);
  return {
    skills,
    job_titles: titles,
    years_experience: years || 0,
    seniority,
    domains,
    // (education/certifications are not required for scoring; left empty for compatibility)
    education: [],
    certifications: [],
  };
}

// Extract skills + title + seniority + domain inferred from a job's metadata.
function parseJob(job) {
  const blob = [job.title || '', job.organization || '', job.org_type || '', job.location || ''].join(' ');
  const skills = extractSkills(blob);
  const titles = extractTitles(blob);
  const seniority = inferSeniority(job.title || '', null);
  // JD domain mapping from org_type, plus any text-domain hits
  const orgTypeDomain = { university: 'education', hospital: 'healthcare', ngo: 'ngo' }[job.org_type];
  const textDomains = inferDomains(blob);
  const domains = Array.from(new Set([orgTypeDomain, ...textDomains].filter(Boolean)));
  return { skills, titles, seniority, domains };
}

module.exports = {
  SKILLS, TITLE_SKILL_MAP, SENIORITY_ORDER, ADJACENT_DOMAINS,
  SKILL_ALIASES, ALIAS_DISPLAY, CANONICAL_REWRITE,
  extractSkills, extractTitles, inferSeniority, inferYears, inferDomains,
  parseResume, parseJob,
};
