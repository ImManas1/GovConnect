import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

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

app.post('/api/legacy/revenue/upsert', (req, res) => {
  const { rationCard, fullName, annualIncome, casteCategory, landHoldingsAcre } = req.body;
  legacyRevenueDB[rationCard] = {
    fullName: fullName || "Citizen, Generic",
    annualIncome: Number(annualIncome) || 200000,
    issuedDate: new Date().toLocaleDateString('en-GB').replace(/\//g, '-'),
    casteCategory: casteCategory || "OPEN",
    landHoldingsAcre: Number(landHoldingsAcre) || 0.0,
    status: "ACTIVE"
  };
  return res.json({ status: "SUCCESS", message: `Record stored in Revenue XML Registry for ${rationCard}` });
});

app.get('/api/legacy/revenue/income', (req, res) => {
  const rationCard = req.query.ration_card;
  const record = legacyRevenueDB[rationCard];

  res.setHeader('Content-Type', 'application/xml');

  if (!record) {
    return res.status(404).send(`
      <DepartmentOfRevenue status="404">
        <Error>Citizen Ration Card ID [${rationCard}] not found</Error>
      </DepartmentOfRevenue>
    `);
  }

  const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<DepartmentOfRevenue>
  <CitizenRecord>
    <RationCardNo>${rationCard}</RationCardNo>
    <FullName>${record.fullName}</FullName>
    <AnnualIncomeDetails>
      <IncomeAmount>${record.annualIncome}</IncomeAmount>
      <Currency>INR</Currency>
    </AnnualIncomeDetails>
    <CasteCategory>${record.casteCategory}</CasteCategory>
    <LandHoldingsAcre>${record.landHoldingsAcre}</LandHoldingsAcre>
    <IssuedDate>${record.issuedDate}</IssuedDate>
    <VerificationStatus>${record.status}</VerificationStatus>
  </CitizenRecord>
</DepartmentOfRevenue>`;

  return res.status(200).send(xmlPayload);
});

const PORT = 4001;
app.listen(PORT, () => console.log(`[LEGACY REVENUE DB] Emitting XML on http://localhost:${PORT}`));
