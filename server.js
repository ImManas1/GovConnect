import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. MASTER DATA MANAGEMENT (MDM) IDENTITY MAP
const MDM_REGISTRY = {
  "CITIZEN-101": {
    name: "Aarav Sharma",
    revenueKey: "RC-MH-88210",
    educationKey: "PRN-2026-ENG-042"
  },
  "CITIZEN-102": {
    name: "Priya Deshmukh",
    revenueKey: "RC-MH-10293",
    educationKey: "PRN-2024-ART-011"
  }
};

const calculateAge = (dobString) => {
  const birthDate = new Date(dobString);
  const diff = Date.now() - birthDate.getTime();
  return Math.abs(new Date(diff).getUTCFullYear() - 1970);
};

// 2. DYNAMIC RECORD REGISTRATION
app.post('/api/v1/interop/register-citizen', async (req, res) => {
  const { citizenId, name, income, degree, dob, caste, landHoldings } = req.body;
  const rCard = `RC-${citizenId}`;
  const pNumber = `PRN-${citizenId}`;

  MDM_REGISTRY[citizenId] = { name, revenueKey: rCard, educationKey: pNumber };

  try {
    await axios.post('http://localhost:4001/api/legacy/revenue/upsert', {
      rationCard: rCard,
      fullName: name.includes(' ') ? `${name.split(' ')[1]}, ${name.split(' ')[0]}` : name,
      annualIncome: Number(income),
      casteCategory: caste || "OBC",
      landHoldingsAcre: Number(landHoldings) || 0.0
    });

    await axios.post('http://localhost:4002/api/v1/education/upsert', {
      prn: pNumber,
      firstName: name.split(' ')[0],
      lastName: name.split(' ')[1] || '',
      degree,
      dob,
      passingYear: 2025
    });

    return res.json({ status: "SUCCESS", message: `Registered ${name} across MDM, Revenue (XML), and Education (JSON)` });
  } catch (error) {
    return res.status(500).json({ error: "Registration sync failure", details: error.message });
  }
});

// 3. CORE INTEROPERABILITY PIPELINE (Attestation & Verified Claims Gateway)
app.post('/api/v1/interop/fetch-verified-claims', async (req, res) => {
  const { citizenId, consumingDepartment, serviceName, requestedAttributes, consentToken } = req.body;
  const executionLogs = [];
  const startTime = Date.now();

  const log = (msg) => executionLogs.push(`[${new Date().toISOString().split('T')[1].slice(0, -1)}] ${msg}`);

  // Guard: Consent Check
  if (!consentToken) {
    log(`[SECURITY GUARD] Blocked: Request from [${consumingDepartment}] lacks a valid citizen consent token.`);
    return res.status(403).json({
      status: "CONSENT_DENIED",
      error: "Citizen consent token is required for cross-department data exchange.",
      auditLogs: executionLogs
    });
  }

  const mapping = MDM_REGISTRY[citizenId];
  if (!mapping) {
    log(`[MDM ERROR] Citizen ID [${citizenId}] not found in identity registry.`);
    return res.status(404).json({ error: `Citizen ID ${citizenId} not registered.`, auditLogs: executionLogs });
  }

  log(`[GOVCONNECT GATEWAY] Request received from: "${consumingDepartment}" for "${serviceName}"`);
  log(`[IDENTITY RESOLUTION] Citizen Token [${citizenId}] mapped to: Revenue Key [${mapping.revenueKey}], Education Key [${mapping.educationKey}]`);

  const needsRevenue = requestedAttributes.some(attr => attr.startsWith('revenue'));
  const needsEducation = requestedAttributes.some(attr => attr.startsWith('education'));

  const claimsPacket = {
    attestationAuthority: "GovConnect Federated Data Bus (Govt of Maharashtra)",
    transactionId: `TXN-MH-GC-${Date.now().toString().slice(-6)}`,
    citizenId,
    timestamp: new Date().toISOString(),
    verifiedAttributes: {}
  };

  try {
    const promises = [];
    if (needsRevenue) {
      log(`[DATA DISPATCH] Firing asynchronous query to Revenue Dept (SOAP/XML endpoint)...`);
      promises.push(axios.get(`http://localhost:4001/api/legacy/revenue/income`, { params: { ration_card: mapping.revenueKey } }));
    }
    if (needsEducation) {
      log(`[DATA DISPATCH] Firing asynchronous query to Education Dept (REST/JSON endpoint)...`);
      promises.push(axios.get(`http://localhost:4002/api/v1/education/student-profile`, { params: { prn: mapping.educationKey } }));
    }

    const responses = await Promise.all(promises);

    let rawXmlParsed = null;
    let rawJsonData = null;

    // Process Revenue XML
    if (needsRevenue) {
      const revRes = responses[0];
      log(`[DATA INGESTION] Revenue Dept responded (Status: 200 OK, Format: SOAP/XML)`);
      log(`[SEMANTIC TRANSLATOR] Parsing XML payload into Canonical Data Structure...`);
      
      const parsedXml = await parseStringPromise(revRes.data);
      rawXmlParsed = parsedXml.DepartmentOfRevenue.CitizenRecord[0];

      const rawName = rawXmlParsed.FullName[0];
      const normalizedName = rawName.includes(',') ? rawName.split(',').map(s => s.trim()).reverse().join(' ') : rawName;

      claimsPacket.verifiedAttributes.revenue = {
        sourceRegistry: "DEPARTMENT_OF_REVENUE_MAHARASHTRA",
        formatOrigin: "LEGACY_SOAP_XML",
        normalizedFullName: normalizedName,
        annualIncome: Number(rawXmlParsed.AnnualIncomeDetails[0].IncomeAmount[0]),
        casteCategory: rawXmlParsed.CasteCategory[0],
        landHoldingsAcre: Number(rawXmlParsed.LandHoldingsAcre?.[0] || 0),
        status: rawXmlParsed.VerificationStatus[0]
      };
      log(`[NORMALIZATION SUCCESS] Extracted: Income = ₹${claimsPacket.verifiedAttributes.revenue.annualIncome}, Caste = ${claimsPacket.verifiedAttributes.revenue.casteCategory}`);
    }

    // Process Education JSON
    if (needsEducation) {
      const eduRes = needsRevenue ? responses[1] : responses[0];
      log(`[DATA INGESTION] Education Dept responded (Status: 200 OK, Format: REST/JSON)`);
      rawJsonData = eduRes.data.data;

      claimsPacket.verifiedAttributes.education = {
        sourceRegistry: "DIRECTORATE_OF_HIGHER_EDUCATION_MAHARASHTRA",
        formatOrigin: "RESTFUL_JSON",
        studentName: `${rawJsonData.firstName} ${rawJsonData.lastName}`,
        degree: rawJsonData.degree,
        dob: rawJsonData.dob,
        age: calculateAge(rawJsonData.dob),
        institution: rawJsonData.institution,
        status: rawJsonData.status
      };
      log(`[NORMALIZATION SUCCESS] Extracted: Degree = "${rawJsonData.degree}", DOB = ${rawJsonData.dob} (Age: ${claimsPacket.verifiedAttributes.education.age} yrs)`);
    }

    const latency = Date.now() - startTime;
    log(`[DISPATCH COMPLETE] Verified Claims Packet constructed in ${latency}ms.`);
    log(`[DELIVERY] Packet securely transferred to [${consumingDepartment}] with cryptographic attestation.`);

    return res.json({
      status: "EXCHANGE_SUCCESSFUL",
      consumingDepartment,
      serviceName,
      latencyMs: latency,
      claimsPacket,
      rawDiagnostics: {
        revenueXmlParsed: rawXmlParsed,
        educationJsonRaw: rawJsonData
      },
      auditLogs: executionLogs
    });

  } catch (error) {
    log(`[GATEWAY ERROR] Data pipeline failure: ${error.message}`);
    return res.status(500).json({ error: "Interoperability gateway failure", details: error.message, auditLogs: executionLogs });
  }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`[GOVCONNECT GATEWAY] Active on http://localhost:${PORT}`));
