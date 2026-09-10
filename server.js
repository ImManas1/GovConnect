import express from 'express';
import cors from 'cors';
import { parseStringPromise } from 'xml2js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve static assets from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Explicit route to serve the frontend on root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 1. IN-MEMORY MOCK DATABASES (REVENUE & EDUCATION)
// ==========================================
const legacyRevenueDB = {
  "RC-MH-88210": {
    fullName: "Sharma, Aarav",
    annualIncome: 180000,
    issuedDate: "14-05-2024",
    casteCategory: "OBC",
    landHoldingsAcre: 2.5,
    status: "ACTIVE"
  },
  "RC-MH-10293": {
    fullName: "Deshmukh, Priya",
    annualIncome: 450000,
    issuedDate: "11-01-2023",
    casteCategory: "OPEN",
    landHoldingsAcre: 0.0,
    status: "ACTIVE"
  }
};

const educationDB = {
  "PRN-2026-ENG-042": {
    firstName: "Aarav",
    lastName: "Sharma",
    degree: "B.Tech Computer Engineering",
    institution: "Government College of Engineering",
    passingYear: 2026,
    dob: "2004-05-14",
    status: "ENROLLED"
  },
  "PRN-2024-ART-011": {
    firstName: "Priya",
    lastName: "Deshmukh",
    degree: "B.A. Economics",
    institution: "State University",
    passingYear: 2024,
    dob: "2001-11-20",
    status: "GRADUATED"
  }
};

const MDM_REGISTRY = {
  "CITIZEN-101": { name: "Aarav Sharma", revenueKey: "RC-MH-88210", educationKey: "PRN-2026-ENG-042" },
  "CITIZEN-102": { name: "Priya Deshmukh", revenueKey: "RC-MH-10293", educationKey: "PRN-2024-ART-011" }
};

const calculateAge = (dobString) => {
  const birthDate = new Date(dobString);
  const diff = Date.now() - birthDate.getTime();
  return Math.abs(new Date(diff).getUTCFullYear() - 1970);
};

// ==========================================
// 2. MOCK DEPARTMENT ENDPOINTS (XML & JSON)
// ==========================================
app.get('/api/legacy/revenue/income', (req, res) => {
  const rationCard = req.query.ration_card;
  const record = legacyRevenueDB[rationCard];
  res.setHeader('Content-Type', 'application/xml');

  if (!record) {
    return res.status(404).send(`<DepartmentOfRevenue status="404"><Error>Not Found</Error></DepartmentOfRevenue>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DepartmentOfRevenue>
  <CitizenRecord>
    <RationCardNo>${rationCard}</RationCardNo>
    <FullName>${record.fullName}</FullName>
    <AnnualIncomeDetails><IncomeAmount>${record.annualIncome}</IncomeAmount></AnnualIncomeDetails>
    <CasteCategory>${record.casteCategory}</CasteCategory>
    <LandHoldingsAcre>${record.landHoldingsAcre}</LandHoldingsAcre>
    <VerificationStatus>${record.status}</VerificationStatus>
  </CitizenRecord>
</DepartmentOfRevenue>`;
  return res.status(200).send(xml);
});

app.get('/api/v1/education/student-profile', (req, res) => {
  const prn = req.query.prn;
  const record = educationDB[prn];
  if (!record) return res.status(404).json({ error: "Not Found" });
  return res.json({ data: record });
});

app.post('/api/v1/interop/register-citizen', (req, res) => {
  const { citizenId, name, income, degree, dob, caste, landHoldings } = req.body;
  const rCard = `RC-${citizenId}`;
  const pNumber = `PRN-${citizenId}`;

  MDM_REGISTRY[citizenId] = { name, revenueKey: rCard, educationKey: pNumber };
  legacyRevenueDB[rCard] = {
    fullName: name.includes(' ') ? `${name.split(' ')[1]}, ${name.split(' ')[0]}` : name,
    annualIncome: Number(income),
    casteCategory: caste || "OBC",
    landHoldingsAcre: Number(landHoldings) || 0.0,
    status: "ACTIVE"
  };
  educationDB[pNumber] = {
    firstName: name.split(' ')[0],
    lastName: name.split(' ')[1] || '',
    degree,
    dob: dob || "2003-01-01",
    status: "VERIFIED"
  };

  return res.json({ status: "SUCCESS" });
});

// ==========================================
// 3. GOVCONNECT CORE INTEROP ENGINE
// ==========================================
app.post('/api/v1/interop/fetch-verified-claims', async (req, res) => {
  const { citizenId, consumingDepartment, serviceName, requestedAttributes, consentToken } = req.body;
  const executionLogs = [];
  const startTime = Date.now();
  const log = (msg) => executionLogs.push(`[${new Date().toISOString().split('T')[1].slice(0, -1)}] ${msg}`);

  if (!consentToken) {
    return res.status(403).json({ status: "CONSENT_DENIED", error: "Citizen consent token required.", auditLogs: executionLogs });
  }

  const mapping = MDM_REGISTRY[citizenId];
  if (!mapping) return res.status(404).json({ error: "Citizen ID not found.", auditLogs: executionLogs });

  log(`[GOVCONNECT BUS] Request received from: "${consumingDepartment}" for "${serviceName}"`);
  log(`[IDENTITY RESOLUTION] Citizen [${citizenId}] mapped: Revenue [${mapping.revenueKey}], Education [${mapping.educationKey}]`);

  const claimsPacket = {
    attestationAuthority: "GovConnect Federated Data Bus (Govt of Maharashtra)",
    transactionId: `TXN-MH-GC-${Date.now().toString().slice(-6)}`,
    citizenId,
    timestamp: new Date().toISOString(),
    verifiedAttributes: {}
  };

  try {
    const needsRevenue = requestedAttributes.some(attr => attr.startsWith('revenue'));
    const needsEducation = requestedAttributes.some(attr => attr.startsWith('education'));

    if (needsRevenue) {
      log(`[DATA DISPATCH] Ingesting Revenue Dept SOAP/XML payload...`);
      const rawRec = legacyRevenueDB[mapping.revenueKey];
      const rawXml = `<DepartmentOfRevenue><CitizenRecord><FullName>${rawRec.fullName}</FullName><AnnualIncomeDetails><IncomeAmount>${rawRec.annualIncome}</IncomeAmount></AnnualIncomeDetails><CasteCategory>${rawRec.casteCategory}</CasteCategory><LandHoldingsAcre>${rawRec.landHoldingsAcre}</LandHoldingsAcre></CitizenRecord></DepartmentOfRevenue>`;
      
      const parsedXml = await parseStringPromise(rawXml);
      const rec = parsedXml.DepartmentOfRevenue.CitizenRecord[0];
      const rawName = rec.FullName[0];
      const normName = rawName.includes(',') ? rawName.split(',').map(s => s.trim()).reverse().join(' ') : rawName;

      claimsPacket.verifiedAttributes.revenue = {
        sourceRegistry: "DEPT_OF_REVENUE_XML",
        normalizedFullName: normName,
        annualIncome: Number(rec.AnnualIncomeDetails[0].IncomeAmount[0]),
        casteCategory: rec.CasteCategory[0],
        landHoldingsAcre: Number(rec.LandHoldingsAcre[0] || 0)
      };
      log(`[SEMANTIC TRANSLATOR] XML parsed -> Income: ₹${claimsPacket.verifiedAttributes.revenue.annualIncome}, Caste: ${claimsPacket.verifiedAttributes.revenue.casteCategory}`);
    }

    if (needsEducation) {
      log(`[DATA DISPATCH] Ingesting Higher Education REST/JSON payload...`);
      const rawEdu = educationDB[mapping.educationKey];
      claimsPacket.verifiedAttributes.education = {
        sourceRegistry: "DIRECTORATE_OF_HIGHER_ED_JSON",
        degree: rawEdu.degree,
        dob: rawEdu.dob,
        age: calculateAge(rawEdu.dob)
      };
      log(`[SEMANTIC TRANSLATOR] JSON normalized -> Degree: "${rawEdu.degree}" (Age: ${claimsPacket.verifiedAttributes.education.age} yrs)`);
    }

    const latency = Date.now() - startTime;
    log(`[M2M COMPLETE] Claims Packet generated and signed in ${latency}ms.`);

    return res.json({
      status: "EXCHANGE_SUCCESSFUL",
      consumingDepartment,
      serviceName,
      latencyMs: latency,
      claimsPacket,
      auditLogs: executionLogs
    });

  } catch (error) {
    return res.status(500).json({ error: error.message, auditLogs: executionLogs });
  }
});

// Fallback for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Bind to Render dynamic port on all network interfaces
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[GOVCONNECT CORE] Running on port ${PORT}`);
});
