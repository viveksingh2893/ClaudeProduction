/**
 * One-time populate of the 11 onboarded sellers' business details from the
 * "seller detail" onboarding sheet (reference/seller_detail.xlsx, extracted
 * verbatim into SELLER_DETAILS below).
 *
 * Fills the business/KYC fields on SellerProfile:
 *   registeredAddress, contactPersonName, companyWebsite, contactEmail,
 *   contactMobile, gstNumber, panNumber, bankName, accountHolder,
 *   accountNumber, ifscCode, bankBranch
 *
 * Deliberately does NOT touch:
 *   - shopName (already set; "Katra" keeps its short display name)
 *   - User.email / User.phone (the account's sign-in credentials — the
 *     sheet's Email / Mobile are the *business* contact and land in the
 *     dedicated contactEmail / contactMobile columns instead)
 *
 * Matches a sheet row to a SellerProfile by shopName, case-insensitive
 * exact, with one explicit override (the sheet's full legal name for the
 * house seller vs its short "Katra" shopName). A row that matches no
 * seller is reported and skipped — nothing is created.
 *
 * Defaults to a dry run: prints the before -> after diff for every field
 * it would change and writes nothing. Pass --apply to write. Idempotent:
 * re-running with the same sheet is a no-op.
 *
 *   pnpm --filter @kisan4u/db exec tsx prisma/populate-seller-details.ts          # dry run
 *   pnpm --filter @kisan4u/db exec tsx prisma/populate-seller-details.ts --apply  # write
 */
import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");

/** shopName (as stored) that a sheet "Company Name" maps to, when they differ. */
const SHOP_NAME_OVERRIDES: Record<string, string> = {
  "KATRA FERTILIZERS & CHEMICALS PRIVATE LIMITED": "Katra",
};

type SheetRow = {
  companyName: string;
  companyAddress: string;
  contactPersonName: string;
  contactEmail: string;
  contactMobile: string;
  gstNumber: string;
  companyWebsite: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  ifscCode: string;
  bankBranch: string;
  panNumber: string;
};

const SELLER_DETAILS: SheetRow[] = [
  {
    companyName: "Sarvin Agro Chemicals Private Limited",
    companyAddress:
      "C/o USHA RANI SINHA, Road Number 5A, Siddhartha Multispeciality Hospital, Rajendra Nagar, Patna, Patna, Bihar, 800016",
    contactPersonName: "Pradeep Kumar",
    contactEmail: "ecommerce.paidavaar@gmail.com",
    contactMobile: "9241878014",
    gstNumber: "10ABMCS7333Q1ZU",
    companyWebsite: "https://paidavaar.in/",
    bankName: "State Bank of India",
    accountHolder: "Sarvin Agro Chemicals Private Limited",
    accountNumber: "42717137349",
    ifscCode: "SBIN0001389",
    bankBranch: "Kankarbagh",
    panNumber: "ABMCS7333Q",
  },
  {
    companyName: "TORRENT CROP SCIENCE",
    companyAddress:
      "VILLAGE AT PIPLANA, SURVEY NO.280, PARMESHWAR INDUSTRIAL AREA 2, KOTDA SANGANI MAIN ROAD, TALUKA KOTDA SANGANI, PLOT NO3 S.PLOT 3/1, Piplana, Rajkot, Gujarat, 360030",
    contactPersonName: "JAYRAJ",
    contactEmail: "info@exylonpesticides.com",
    contactMobile: "7600054554",
    gstNumber: "24AATFT0271F1Z5",
    companyWebsite: "https://exylonpesticides.com/",
    bankName: "HDFC Bank",
    accountHolder: "TORRENT CROP SCIENCE",
    accountNumber: "50200070570890",
    ifscCode: "HDFC0003109",
    bankBranch: "MOTA MAVA",
    panNumber: "AATFT0271F",
  },
  {
    companyName: "Shurbans international Pvt Ltd",
    companyAddress:
      "53 RAMCHARAN GALI AHEER TOLA NEAR DAUJI MANDIR SIRSAGANJ FIROJABAD UTTAR PRADESH 283151",
    contactPersonName: "Sujjoy Gupta",
    contactEmail: "sujjoygupta92194@gmail.com",
    contactMobile: "7906273537",
    gstNumber: "09ABACS2342H1ZH",
    companyWebsite: "",
    bankName: "Axis Bank",
    accountHolder: "SHURBANS INTERNATIONAL PRIVATE LIMITED",
    accountNumber: "919020053442199",
    ifscCode: "UTIB0001801",
    bankBranch: "SIRSAGANJ",
    panNumber: "ABACS2342H",
  },
  {
    companyName: "HIFIELD ORGANICS INC",
    companyAddress:
      "NORTH WING, PLOT NO 39/26, SECTOR G, MIDC, WALUJ,Chhtrapati Sambhajinagar ,Aurangabad, Maharashtra 431136",
    contactPersonName: "CHHAYA SAWANT",
    contactEmail: "ecommerce@hifieldorganics.com",
    contactMobile: "7770008037",
    gstNumber: "27AAUPD1218M1ZH",
    companyWebsite: "https://www.hifieldorganicsinc.com/",
    bankName: "State Bank of India",
    accountHolder: "Hifield Organics Inc State Bank Of India, Ifb,",
    accountNumber: "38266332078",
    ifscCode: "SBIN0006834",
    bankBranch: "Kranti Chowk",
    panNumber: "AAUPD1218M",
  },
  {
    companyName: "Aries Agro Limited",
    companyAddress:
      "Aries House, Plot No.24 , Deonar, Govandi East Near M -ward MUMBAI Maharashtra 400043",
    contactPersonName: "HRISHIKESH",
    contactEmail: "hpatil@ariesagro.com",
    contactMobile: "9970594917",
    gstNumber: "27AAACA5035G1Z1",
    companyWebsite: "",
    bankName: "Yes Bank",
    accountHolder: "ARIES AGRO LIMITED",
    accountNumber: "5884600001843",
    ifscCode: "YESB0000058",
    bankBranch: "Chembur",
    panNumber: "AAACA5035G",
  },
  {
    companyName: "HIFIELD AG CHEM INDIA PVT LTD",
    companyAddress:
      "G 39/26, MIDC, WALUJ, Chhatrapati Sambhaji Nagar, Maharashtra, 431136",
    contactPersonName: "CHHAYA SAWANT",
    contactEmail: "ecommerce@hifield-ag.com",
    contactMobile: "8380007440",
    gstNumber: "27AAACH5786P1ZT",
    companyWebsite: "https://www.hifield-ag.co.in",
    bankName: "State Bank of India",
    accountHolder: "Hifield-Ag Chem.India Pvt.Ltd.",
    accountNumber: "30407338966",
    ifscCode: "SBIN0006834",
    bankBranch: "Kranti Chowk",
    panNumber: "AAACH5786P",
  },
  {
    companyName: "TITAN AGRITECH LIMITED",
    companyAddress:
      "G1-635-636, RIICO INDUSTRIAL AREA CHOPANKI Bhiwadi, Alwar, Rajasthan, 301019",
    contactPersonName: "Yogeeta",
    contactEmail: "titanagritechltd2@gmail.com",
    contactMobile: "9315911272",
    gstNumber: "08AAJCT9035A1ZD",
    companyWebsite: "https://www.titanagritech.com/",
    bankName: "HDFC Bank",
    accountHolder: "TITAN AGRITECH LIMITED",
    accountNumber: "50200077696492",
    ifscCode: "HDFC0001261",
    bankBranch: "ASHOK VIHAR",
    panNumber: "AAJCT9035A",
  },
  {
    companyName: "Kay Bee Bio-Organics Pvt. Ltd",
    companyAddress:
      "Kay Bee Bio Organics Pvt. Ltd., Office No. 208, 209 & 210. 2nd Floor, SPRINT Antaaya, Opposite Balewadi Stadium, Near Marvel Cascada, Balewadi, Pune, Maharashtra 411045",
    contactPersonName: "Amruta Jadhav",
    contactEmail: "connect@kaybeebio.com",
    contactMobile: "9137860211",
    gstNumber: "27AAHCR3501K2ZC",
    companyWebsite: "https://kaybeebio.com/",
    bankName: "Yes Bank",
    accountHolder: "KAY BEE BIO-ORGANICS PRIVATE LIMITED",
    accountNumber: "7781300000893",
    ifscCode: "YESB0000077",
    bankBranch: "Talaopali",
    panNumber: "AAHCR3501K",
  },
  {
    companyName: "Geolife Agritech India Private Limited",
    companyAddress:
      "301, Marathon Max, Goregaon-Mulund Link Road, Salpa LBS Marg OPPOSITE NIRMAL LIFESTYLE mulund west Mumbai Maharashtra 400080",
    contactPersonName: "Mukesh Vanian",
    contactEmail: "manager.ecommerce@geolife.com",
    contactMobile: "9028010670",
    gstNumber: "27AAECG6849G1ZB",
    companyWebsite: "",
    bankName: "Kotak Mahindra Bank",
    accountHolder: "GEOLIFE AGRITECH INDIA PVT LTD",
    accountNumber: "6111331965",
    ifscCode: "KKBK0000642",
    bankBranch: "Mulund",
    panNumber: "AAECG6849G",
  },
  {
    companyName: "Royal Traders",
    companyAddress: "A-12, Ground Floor, Chetak Center, 12/2, RNT Marg, Indore, 452001",
    contactPersonName: "Mohammad Ariph",
    contactEmail: "mailtoroyaltraders@gmail.com",
    contactMobile: "7224853641",
    gstNumber: "23BEKPA3111H1Z8",
    companyWebsite: "",
    bankName: "Punjab National bank",
    accountHolder: "Royal Traders",
    accountNumber: "1831131003009",
    ifscCode: "PUNB0018310",
    bankBranch: "RNT Road",
    panNumber: "BEKPA3111H",
  },
  {
    companyName: "KATRA FERTILIZERS & CHEMICALS PRIVATE LIMITED",
    companyAddress: "3RD, 306, CHETAK CENTRE 12/2, RNT MARG, INDORE 452001",
    contactPersonName: "Khuzema Latthewala",
    contactEmail: "Katrafert@gmail.com",
    contactMobile: "8085185253",
    gstNumber: "23AAFCK5451P1Z7",
    companyWebsite: "",
    bankName: "HDFC BANK LTD",
    accountHolder: "Katra Fertilizers & Chemicals Private Limited",
    accountNumber: "50200006325914",
    ifscCode: "HDFC0000036",
    bankBranch: "Trade House",
    panNumber: "AAFCK5451P",
  },
];

/** SellerProfile columns this script owns, mapped from a sheet row. Empty string -> null. */
function targetFields(row: SheetRow) {
  const s = (v: string) => (v.trim() ? v.trim() : null);
  return {
    registeredAddress: s(row.companyAddress),
    contactPersonName: s(row.contactPersonName),
    companyWebsite: s(row.companyWebsite),
    contactEmail: row.contactEmail.trim() ? row.contactEmail.trim().toLowerCase() : null,
    contactMobile: s(row.contactMobile),
    gstNumber: row.gstNumber.trim() ? row.gstNumber.trim().toUpperCase() : null,
    panNumber: row.panNumber.trim() ? row.panNumber.trim().toUpperCase() : null,
    bankName: s(row.bankName),
    accountHolder: s(row.accountHolder),
    accountNumber: s(row.accountNumber),
    ifscCode: row.ifscCode.trim() ? row.ifscCode.trim().toUpperCase() : null,
    bankBranch: s(row.bankBranch),
  };
}

async function main() {
  console.log(
    `\nPopulate seller business details — ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}\n`,
  );

  const profiles = await prisma.sellerProfile.findMany({
    select: {
      id: true,
      shopName: true,
      registeredAddress: true,
      contactPersonName: true,
      companyWebsite: true,
      contactEmail: true,
      contactMobile: true,
      gstNumber: true,
      panNumber: true,
      bankName: true,
      accountHolder: true,
      accountNumber: true,
      ifscCode: true,
      bankBranch: true,
    },
  });
  const byName = new Map(profiles.map((p) => [p.shopName.trim().toLowerCase(), p]));

  let matched = 0;
  let changed = 0;
  const unmatched: string[] = [];

  for (const row of SELLER_DETAILS) {
    const wantedName = (SHOP_NAME_OVERRIDES[row.companyName] ?? row.companyName).trim().toLowerCase();
    const profile = byName.get(wantedName);
    if (!profile) {
      unmatched.push(row.companyName);
      continue;
    }
    matched += 1;

    const next = targetFields(row);
    const diffs: string[] = [];
    for (const [key, value] of Object.entries(next) as [keyof typeof next, string | null][]) {
      const current = (profile as unknown as Record<string, string | null>)[key] ?? null;
      if (current !== value) diffs.push(`    ${key}: ${JSON.stringify(current)} -> ${JSON.stringify(value)}`);
    }

    if (diffs.length === 0) {
      console.log(`= ${profile.shopName} — already up to date`);
      continue;
    }
    changed += 1;
    console.log(`~ ${profile.shopName} (${profile.id})`);
    console.log(diffs.join("\n"));

    if (APPLY) {
      await prisma.sellerProfile.update({ where: { id: profile.id }, data: next });
    }
  }

  console.log(
    `\nSheet rows: ${SELLER_DETAILS.length} | matched: ${matched} | with changes: ${changed}` +
      (APPLY ? " (written)" : " (dry run — nothing written)"),
  );
  if (unmatched.length) {
    console.log(`\nUNMATCHED (no SellerProfile with that shopName — skipped, nothing created):`);
    for (const n of unmatched) console.log(`  - ${n}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
