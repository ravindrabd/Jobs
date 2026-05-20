// Hardcoded skill list + alias map (single-user app — no resume parsing).
// Each entry: { canonical, terms } where `terms` are the strings to check in JD/title.
// Matching is word-boundary, case-insensitive.

const SKILL_GROUPS = [
  // Programming
  { canonical: 'Java',              terms: ['Java'] },
  { canonical: 'Python',            terms: ['Python'] },
  { canonical: 'JavaScript',        terms: ['JavaScript', 'JS'] },
  { canonical: 'TypeScript',        terms: ['TypeScript', 'TS'] },
  { canonical: 'C',                 terms: ['C programming', 'C language'] }, // bare "C" too noisy
  { canonical: 'C++',               terms: ['C++', 'CPP'] },
  { canonical: 'Scala',             terms: ['Scala'] },

  // Back-End
  { canonical: 'Spring Boot',       terms: ['Spring Boot', 'SpringBoot'] },
  { canonical: 'Spring MVC',        terms: ['Spring MVC'] },
  { canonical: 'Spring Data JPA',   terms: ['Spring Data JPA'] },
  { canonical: 'Spring Framework',  terms: ['Spring Framework'] },
  { canonical: 'Spring Actuator',   terms: ['Spring Actuator'] },
  { canonical: 'Hibernate',         terms: ['Hibernate'] },
  { canonical: 'Microservices',     terms: ['Microservices', 'Microservice'] },
  { canonical: 'REST API',          terms: ['REST API', 'REST APIs', 'RESTful', 'REST'] },
  { canonical: 'J2EE',              terms: ['J2EE', 'Java EE', 'JEE'] },
  { canonical: 'Node.js',           terms: ['Node.js', 'NodeJS', 'Node JS'] },
  { canonical: 'API',               terms: ['API integration', 'API design', 'API development'] }, // bare "API" everywhere

  // Front-End
  { canonical: 'Angular',           terms: ['Angular', 'AngularJS'] },
  { canonical: 'React',             terms: ['React', 'ReactJS', 'React.js'] },
  { canonical: 'Redux',             terms: ['Redux'] },
  // Removed HTML — too many non-software JDs reference HTML email / HTML forms.
  { canonical: 'CSS',               terms: ['CSS3', 'CSS'] },
  { canonical: 'Bootstrap',         terms: ['Bootstrap'] },
  { canonical: 'jQuery',            terms: ['jQuery'] },
  { canonical: 'GraphQL',           terms: ['GraphQL'] },
  { canonical: 'gRPC',              terms: ['gRPC'] },

  // Cloud & DevOps
  { canonical: 'AWS',               terms: ['AWS', 'Amazon Web Services'] },
  { canonical: 'EC2',               terms: ['EC2'] },
  { canonical: 'S3',                terms: ['AWS S3', 'Amazon S3', 'S3 bucket'] }, // bare S3 too noisy
  { canonical: 'RDS',               terms: ['RDS', 'Aurora RDS'] },
  // Removed Aurora — bare "Aurora" matches "Aurora, CO" location strings (false positive).
  { canonical: 'Lambda',            terms: ['AWS Lambda', 'Lambda function'] },
  { canonical: 'EKS',               terms: ['EKS'] },
  { canonical: 'SQS',               terms: ['SQS'] },
  { canonical: 'Azure',             terms: ['Azure', 'Microsoft Azure'] },
  { canonical: 'Azure Functions',   terms: ['Azure Functions'] },
  { canonical: 'GCP',               terms: ['GCP', 'Google Cloud', 'Google Cloud Platform'] },
  { canonical: 'Docker',            terms: ['Docker', 'Dockerfile', 'containerization'] },
  { canonical: 'Kubernetes',        terms: ['Kubernetes', 'K8s'] },
  { canonical: 'Jenkins',           terms: ['Jenkins'] },
  { canonical: 'PCF',               terms: ['PCF', 'Pivotal Cloud Foundry'] },
  { canonical: 'CI/CD',             terms: ['CI/CD', 'CICD', 'Continuous Integration', 'Continuous Deployment', 'Continuous Delivery'] },
  { canonical: 'DevOps',            terms: ['DevOps', 'Dev Ops'] },
  { canonical: 'Multicloud',        terms: ['Multicloud', 'Multi-cloud'] },
  { canonical: 'Terraform',         terms: ['Terraform'] },
  { canonical: 'Ansible',           terms: ['Ansible'] },
  { canonical: 'Linux',             terms: ['Linux'] },
  { canonical: 'Unix',              terms: ['Unix'] },
  { canonical: 'Shell',             terms: ['Shell scripting'] },
  { canonical: 'Bash',              terms: ['Bash'] },

  // Data & AI/ML
  { canonical: 'Apache Spark',      terms: ['Apache Spark', 'Spark', 'Spark Streaming', 'PySpark'] },
  { canonical: 'Hive',              terms: ['Hive'] },
  { canonical: 'Hadoop',            terms: ['Hadoop'] },
  { canonical: 'Cassandra',         terms: ['Cassandra'] },
  { canonical: 'Solr',              terms: ['Solr'] },
  { canonical: 'TensorFlow',        terms: ['TensorFlow'] },
  { canonical: 'Scikit-learn',      terms: ['Scikit-learn', 'Sklearn', 'scikit-learn'] },
  { canonical: 'Machine Learning',  terms: ['Machine Learning', 'ML algorithms'] },
  // Removed AI — appears in too many non-tech JDs ("AI literacy", "AI initiative", etc).
  // Keep Machine Learning + LLM + Generative AI for stricter matches.
  { canonical: 'LLM',               terms: ['LLM', 'Large Language Model', 'large language models'] },
  { canonical: 'Generative AI',     terms: ['Generative AI', 'GenAI'] },
  { canonical: 'ETL',               terms: ['ETL', 'data pipeline'] },
  { canonical: 'Pandas',            terms: ['Pandas'] },
  { canonical: 'NumPy',             terms: ['NumPy'] },
  { canonical: 'Jupyter',           terms: ['Jupyter'] },
  { canonical: 'Databricks',        terms: ['Databricks'] },
  { canonical: 'Snowflake',         terms: ['Snowflake'] },
  { canonical: 'Redshift',          terms: ['Redshift'] },
  { canonical: 'Airflow',           terms: ['Airflow'] },
  { canonical: 'dbt',               terms: ['dbt'] },

  // Python web frameworks
  { canonical: 'Flask',             terms: ['Flask'] },
  { canonical: 'Django',            terms: ['Django'] },
  { canonical: 'FastAPI',           terms: ['FastAPI'] },

  // Messaging
  { canonical: 'Apache Kafka',      terms: ['Apache Kafka', 'Kafka'] },
  { canonical: 'JMS',               terms: ['JMS'] },
  { canonical: 'RabbitMQ',          terms: ['RabbitMQ'] },
  { canonical: 'ActiveMQ',          terms: ['ActiveMQ'] },

  // Databases
  { canonical: 'SQL',               terms: ['SQL'] },
  { canonical: 'PL/SQL',            terms: ['PL/SQL', 'PL-SQL', 'PLSQL'] },
  { canonical: 'Oracle',            terms: ['Oracle Database', 'Oracle DB', 'OracleDB', 'Oracle Certified'] },
  { canonical: 'SQL Server',        terms: ['SQL Server', 'MSSQL', 'Microsoft SQL Server'] },
  { canonical: 'MySQL',             terms: ['MySQL'] },
  { canonical: 'DB2',               terms: ['DB2'] },
  { canonical: 'MongoDB',           terms: ['MongoDB', 'Mongo'] },
  { canonical: 'PostgreSQL',        terms: ['PostgreSQL', 'Postgres'] },
  { canonical: 'DynamoDB',          terms: ['DynamoDB'] },
  { canonical: 'Firebase',          terms: ['Firebase'] },
  { canonical: 'Redis',             terms: ['Redis'] },
  { canonical: 'Elasticsearch',     terms: ['Elasticsearch', 'Elastic Search'] },

  // Tools & QA
  { canonical: 'Log4j',             terms: ['Log4j'] },
  { canonical: 'Splunk',            terms: ['Splunk'] },
  { canonical: 'JUnit',             terms: ['JUnit'] },
  { canonical: 'Maven',             terms: ['Maven'] },
  { canonical: 'Gradle',            terms: ['Gradle'] },
  { canonical: 'Git',               terms: ['Git', 'GitHub', 'GitLab'] },
  { canonical: 'Bitbucket',         terms: ['Bitbucket'] },
  { canonical: 'SVN',               terms: ['SVN', 'Subversion'] },
  // Removed Bamboo, JIRA, Rally — project-management tools used by non-software jobs too.
  { canonical: 'Tomcat',            terms: ['Tomcat'] },
  { canonical: 'JBoss',             terms: ['JBoss'] },
  { canonical: 'WebLogic',          terms: ['WebLogic'] },
  { canonical: 'IntelliJ',          terms: ['IntelliJ'] },
  { canonical: 'Eclipse',           terms: ['Eclipse IDE'] }, // bare "Eclipse" too noisy
  { canonical: 'STS',               terms: ['Spring Tool Suite'] },
  { canonical: 'Agile',             terms: ['Agile'] },
  { canonical: 'Scrum',             terms: ['Scrum'] },
  { canonical: 'SDLC',              terms: ['SDLC'] },
  { canonical: 'Full Stack',        terms: ['Full Stack', 'Fullstack', 'Full-Stack'] },
  { canonical: 'Kibana',            terms: ['Kibana'] },
  { canonical: 'Grafana',           terms: ['Grafana'] },
  { canonical: 'Prometheus',        terms: ['Prometheus'] },
  { canonical: 'Power BI',          terms: ['Power BI', 'PowerBI'] },
  { canonical: 'Tableau',           terms: ['Tableau'] },
  { canonical: 'Looker',            terms: ['Looker'] },

  // ERP & Enterprise — REMOVED.
  // Reason: non-software jobs (admin, HR, project mgmt, sales) commonly use these,
  // so matches were creating false-positive software-job hits.
  // Removed: PeopleSoft, ERP, SAP, Workday, Salesforce, SharePoint, Dynamics, Banner, Ellucian, ServiceNow

  // CMS — REMOVED for the same reason (marketing/content roles mention these).
  // Removed: CMS, Content Management System, WordPress, Drupal, Joomla, Sitecore, AEM, Adobe Experience Manager, Contentful, Strapi, Magento
];

// Skills the user does NOT have — used to compute "total skills found in JD"
// so match% = matched / jd_skills_found * 100 (instead of matched / MY_SKILLS_total).
const OTHER_SKILLS = [
  { canonical: 'Go',          terms: ['Go programming', 'Golang', 'Go language'] },
  { canonical: 'Rust',        terms: ['Rust'] },
  { canonical: 'Ruby',        terms: ['Ruby', 'Ruby on Rails'] },
  { canonical: 'Rails',       terms: ['Rails framework', 'Ruby on Rails'] },
  { canonical: 'PHP',         terms: ['PHP'] },
  { canonical: 'Perl',        terms: ['Perl'] },
  { canonical: 'R',           terms: ['R programming', 'R language', 'R statistical'] },
  { canonical: 'Swift',       terms: ['Swift'] },
  { canonical: 'Kotlin',      terms: ['Kotlin'] },
  { canonical: 'Objective-C', terms: ['Objective-C', 'Objective C'] },
  { canonical: 'COBOL',       terms: ['COBOL'] },
  { canonical: 'Fortran',     terms: ['Fortran'] },
  { canonical: 'Clojure',     terms: ['Clojure'] },
  { canonical: 'Elixir',      terms: ['Elixir'] },
  { canonical: 'Erlang',      terms: ['Erlang'] },
  { canonical: 'Haskell',     terms: ['Haskell'] },
  { canonical: 'F#',          terms: ['F#'] },
  { canonical: 'Vue',         terms: ['Vue.js', 'VueJS', 'Vue framework'] },
  { canonical: 'Svelte',      terms: ['Svelte'] },
  { canonical: 'Next.js',     terms: ['Next.js', 'NextJS'] },
  { canonical: 'Nuxt',        terms: ['Nuxt'] },
  { canonical: 'ASP.NET',     terms: ['ASP.NET', 'ASP .NET'] },
  { canonical: '.NET',        terms: ['.NET Core', '.NET Framework', 'dotnet'] },
  { canonical: 'Laravel',     terms: ['Laravel'] },
  { canonical: 'Symfony',     terms: ['Symfony'] },
  { canonical: 'PyTorch',     terms: ['PyTorch'] },
  { canonical: 'Keras',       terms: ['Keras'] },
  { canonical: 'Caffe',       terms: ['Caffe'] },
  { canonical: 'MariaDB',     terms: ['MariaDB'] },
  { canonical: 'CouchDB',     terms: ['CouchDB'] },
  { canonical: 'Neo4j',       terms: ['Neo4j'] },
  { canonical: 'InfluxDB',    terms: ['InfluxDB'] },
  { canonical: 'ClickHouse',  terms: ['ClickHouse'] },
  { canonical: 'CockroachDB', terms: ['CockroachDB', 'Cockroach DB'] },
  { canonical: 'Helm',        terms: ['Helm chart', 'Helm package'] },
  { canonical: 'Vault',       terms: ['HashiCorp Vault'] },
  { canonical: 'Consul',      terms: ['HashiCorp Consul'] },
  { canonical: 'Chef',        terms: ['Chef cookbook'] },
  { canonical: 'Puppet',      terms: ['Puppet config', 'Puppet manifest'] },
  { canonical: 'Vagrant',     terms: ['Vagrant'] },
  { canonical: 'OpenShift',   terms: ['OpenShift'] },
  { canonical: 'Flink',       terms: ['Apache Flink', 'Flink streaming'] },
  { canonical: 'Beam',        terms: ['Apache Beam'] },
  { canonical: 'Storm',       terms: ['Apache Storm'] },
  { canonical: 'NiFi',        terms: ['Apache NiFi'] },
  { canonical: 'Pulsar',      terms: ['Apache Pulsar'] },
  { canonical: 'HBase',       terms: ['HBase'] },
  { canonical: 'Impala',      terms: ['Impala'] },
  { canonical: 'Trino',       terms: ['Trino'] },
  { canonical: 'Presto',      terms: ['Presto'] },
  { canonical: 'Pig',         terms: ['Apache Pig'] },
  { canonical: 'Sqoop',       terms: ['Sqoop'] },
  { canonical: 'BigQuery',    terms: ['BigQuery'] },
  { canonical: 'Cloud Run',   terms: ['Cloud Run', 'Cloud Functions'] },
  { canonical: 'ECS',         terms: ['Amazon ECS', 'AWS ECS'] },
  { canonical: 'Fargate',     terms: ['Fargate'] },
  { canonical: 'CloudFront',  terms: ['CloudFront'] },
  { canonical: 'Beanstalk',   terms: ['Elastic Beanstalk'] },
  { canonical: 'Heroku',      terms: ['Heroku'] },
  { canonical: 'Cypress',     terms: ['Cypress'] },
  { canonical: 'Selenium',    terms: ['Selenium'] },
  { canonical: 'Playwright',  terms: ['Playwright'] },
  { canonical: 'Postman',     terms: ['Postman API', 'Postman tool'] },
  { canonical: 'Mockito',     terms: ['Mockito'] },
  { canonical: 'TestNG',      terms: ['TestNG'] },
  { canonical: 'Pytest',      terms: ['Pytest'] },
  { canonical: 'Jest',        terms: ['Jest'] },
];

// Flat list — only canonicals — useful for the resume page / display.
const MY_SKILLS = SKILL_GROUPS.map(g => g.canonical);

// Title blocklist — these are roles we never want in the board even if the JD
// mentions tech keywords (e.g. lecturers in CS describe Python/Java in their syllabus).
const TITLE_BLOCK_TERMS = [
  'lecturer', 'professor', 'instructor', 'faculty', 'adjunct',
  'postdoc', 'post-doctoral', 'postdoctoral', 'post doc',
  'teacher', 'teaching',
  'dean', 'provost',
  'counselor', 'admissions',
  'financial aid', 'librarian', 'custodian',
  'housekeeper', 'cook', 'chef', 'driver',
  'security guard', 'police officer', 'police',
  'nurse', 'nursing',
  'physician', 'doctor', 'surgeon', 'therapist',
  'pharmacist', 'paramedic', 'phlebotomist',
];
function isBlockedTitle(title) {
  if (!title) return false;
  const t = title.toLowerCase();
  for (const term of TITLE_BLOCK_TERMS) {
    const re = new RegExp(`(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9]|$)`, 'i');
    if (re.test(t)) return true;
  }
  return false;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function compile(groups) {
  return groups.map(g => ({
    canonical: g.canonical,
    regexes: g.terms.map(t => new RegExp(`(?:^|[^a-z0-9+#])${escapeRe(t.toLowerCase())}(?:[^a-z0-9+#]|$)`, 'i')),
  }));
}
const _MY = compile(SKILL_GROUPS);
const _OTHER = compile(OTHER_SKILLS);

// Match a text blob (jd_text or title) against MY_SKILLS using all aliases.
//   matched = MY_SKILLS canonicals that appear in JD
//   missing = MY_SKILLS canonicals NOT in JD
//   total_jd_skills = MY hits + OTHER hits (skills the JD mentions that I don't have)
//   score = matched / total_jd_skills × 100   ← the new formula you asked for
function findMatches(text) {
  if (!text) return { matched: [], missing: MY_SKILLS.slice(), score: 0, total_jd_skills: 0 };
  const matched = [];
  const missing = [];
  for (const g of _MY) {
    if (g.regexes.some(re => re.test(text))) matched.push(g.canonical);
    else missing.push(g.canonical);
  }
  let otherHits = 0;
  for (const g of _OTHER) {
    if (g.regexes.some(re => re.test(text))) otherHits++;
  }
  const total_jd_skills = matched.length + otherHits;
  const score = total_jd_skills ? Math.round((matched.length / total_jd_skills) * 100) : 0;
  return { matched, missing, score, total_jd_skills };
}

module.exports = { SKILL_GROUPS, MY_SKILLS, OTHER_SKILLS, TITLE_BLOCK_TERMS, findMatches, isBlockedTitle };
