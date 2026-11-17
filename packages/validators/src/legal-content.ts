/**
 * Single source of truth for the storefront's legal / policy pages, so the
 * website (apps/web/src/app/{terms,privacy,...}/page.tsx) and the mobile
 * app ((app)/legal/[slug]) render exactly the same text. Plain data only
 * — no JSX, no Node APIs — so it's safe to bundle into React Native.
 *
 * Email addresses and phone numbers are left as plain text inside the
 * paragraphs; each renderer linkifies them (mailto: / tel:).
 */

export type LegalSection = {
  /** Omitted for a lead-in paragraph that sits above the first numbered heading. */
  heading?: string;
  paragraphs: string[];
  /** Bulleted list rendered after the paragraphs. */
  list?: string[];
};

export type LegalDoc = {
  slug: LegalSlug;
  /** Storefront route, e.g. "/terms". */
  href: string;
  title: string;
  lastUpdated?: string;
  sections: LegalSection[];
};

export const LEGAL_SLUGS = [
  "about",
  "terms",
  "privacy",
  "return-policy",
  "cancellation-policy",
  "shipping-policy",
  "contact",
] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export const LEGAL_DOCS: Record<LegalSlug, LegalDoc> = {
  about: {
    slug: "about",
    href: "/about",
    title: "About Us",
    sections: [
      {
        paragraphs: [
          "Kisan4U is a multi-seller marketplace for agricultural inputs — crop nutrition, crop protection, seeds, and farm equipment — built to connect India's dealers, sellers, and farmers on one platform. We started with dealers and wholesale supply first, and are extending that same catalogue and pricing discipline to individual customers as we grow.",
        ],
      },
      {
        heading: "What we do",
        paragraphs: [
          "Kisan4U brings together approved sellers offering genuine, licence-verified agricultural products with dealers and farmers who need them, in the states those products are actually available to sell in. Every seller and every product goes through an admin approval step before it reaches the catalogue, and every dealer application is verified before they can buy at dealer pricing.",
        ],
      },
      {
        heading: "How we work",
        paragraphs: [],
        list: [
          "A single catalogue spanning crop nutrition, crop protection, seeds, and equipment — organised by category, crop, and pest/disease so the right product is easy to find.",
          "Separate customer and dealer pricing and minimum-order rules, with dealer availability scoped to the states a product is actually licensed to sell in.",
          "Cash on Delivery, full online payment, and partial (advance + balance) payment options, plus a Kisan4U Wallet for store credit and dealer loyalty points.",
          "Kisan4U Courier for doorstep delivery, with dealers able to arrange their own transport where that suits them better.",
          "A Business Associate program for people who want to refer dealers and customers into Kisan4U and earn commission for doing it.",
          "The storefront and app are available in English, Hindi, Marathi, Telugu, and Tamil, so language is never a barrier to using Kisan4U.",
        ],
      },
      {
        heading: "Who we are",
        paragraphs: [
          "Kisan4U is operated by Kisan4u Marketing Pvt. Ltd. For our registered office and how to reach us, see our Contact Us page.",
        ],
      },
    ],
  },
  terms: {
    slug: "terms",
    href: "/terms",
    title: "Terms & Conditions",
    lastUpdated: "March 2025",
    sections: [
      {
        paragraphs: [
          "Welcome to Kisan4u.com. By accessing or using our e-commerce website and mobile application, you agree to be bound by these Terms and Conditions. Please read them carefully before using our services.",
        ],
      },
      {
        heading: "1. Definitions",
        paragraphs: [
          "Kisan4u refers to the e-commerce platform, including the website and mobile application, operated by Kisan4u Marketing Pvt. Ltd. A user is any person who accesses, registers, or transacts on Kisan4u. A seller is any entity or individual selling products on Kisan4u, while a buyer is a user purchasing products through the platform. A Business Associate (BA) is an individual promoting Kisan4u under the referral program.",
        ],
      },
      {
        heading: "2. Eligibility",
        paragraphs: [
          "Users must be at least 18 years old to create an account and make purchases. Sellers must have the necessary licenses to sell their products. Kisan4u reserves the right to suspend or terminate accounts if any false information is provided.",
        ],
      },
      {
        heading: "3. Account Registration",
        paragraphs: [
          "Users must provide accurate and complete information while registering. Account security is the user's responsibility, and Kisan4u is not liable for unauthorized access. Any suspicious activity must be reported immediately.",
        ],
      },
      {
        heading: "4. Product Listings and Purchases",
        paragraphs: [
          "Kisan4u facilitates transactions between buyers and sellers but does not manufacture or own the listed products. Product descriptions, images, and prices are provided by sellers, and Kisan4u is not liable for discrepancies. Buyers are responsible for verifying product details before making a purchase.",
        ],
      },
      {
        heading: "5. Payments and Transactions",
        paragraphs: [
          "Payments can be made via online banking, UPI, credit/debit cards, and cash on delivery (if available). All payments are processed through secure gateways, and Kisan4u does not store payment details. In case of payment failure, users must contact their respective banks.",
        ],
      },
      {
        heading: "6. Shipping and Delivery",
        paragraphs: [
          "Delivery times vary based on the seller and location, and estimated delivery dates are provided but not guaranteed. Buyers must provide accurate shipping addresses, and if a product is undelivered due to incorrect information, additional charges may apply.",
        ],
      },
      {
        heading: "7. Returns, Refunds, and Cancellations",
        paragraphs: [
          "Return and refund policies vary by seller and product category, and users must check individual product return policies before purchase. Refunds, if applicable, are processed within 7–10 business days. Orders can only be cancelled before dispatch, and once shipped, cancellation is subject to the seller's policy.",
        ],
      },
      {
        heading: "8. Business Associate (BA) Referral Program",
        paragraphs: [
          "Registered BAs earn referral points and commissions based on transactions generated through their referral ID. Kisan4u reserves the right to modify commission structures and payout terms. Fraudulent referrals or misuse of the program will lead to disqualification and account suspension.",
        ],
      },
      {
        heading: "9. User Conduct",
        paragraphs: [
          "Users agree not to violate any laws or regulations, post false or misleading information, attempt to interfere with Kisan4u's security systems, or use automated systems such as bots or scrapers to access the platform.",
        ],
      },
      {
        heading: "10. Intellectual Property",
        paragraphs: [
          "All content on Kisan4u, including logos, text, images, and software, is owned by Kisan4u Marketing Pvt. Ltd. Unauthorized use, reproduction, or distribution of content is strictly prohibited.",
        ],
      },
      {
        heading: "11. Limitation of Liability",
        paragraphs: [
          "Kisan4u acts as a marketplace and does not take responsibility for product defects, delivery failures, or disputes between buyers and sellers. The platform shall not be liable for any direct, indirect, incidental, or consequential damages arising from its use.",
        ],
      },
      {
        heading: "12. Privacy Policy",
        paragraphs: [
          "Users' personal data is collected and processed as per Kisan4u's Privacy Policy. Kisan4u does not sell or share user data with third parties without consent, except as required by law.",
        ],
      },
      {
        heading: "13. Termination of Services",
        paragraphs: [
          "Kisan4u reserves the right to suspend or terminate accounts that violate these terms. Users may also deactivate their accounts at any time by contacting support.",
        ],
      },
      {
        heading: "14. Governing Law and Dispute Resolution",
        paragraphs: [
          "These terms are governed by the laws of India, and any disputes shall be resolved through arbitration in Indore, Madhya Pradesh, in accordance with the Arbitration and Conciliation Act, 1996. If any disputes arise that cannot be settled amicably, they will be subject to the jurisdiction of the courts in Indore, Madhya Pradesh.",
        ],
      },
      {
        heading: "15. Compliance with Indian E-Commerce Laws",
        paragraphs: [
          "Kisan4u adheres to the Consumer Protection (E-Commerce) Rules, 2020, ensuring transparency in transactions and user rights. Sellers must comply with applicable legal requirements, including the Legal Metrology Act, 2009, for product disclosures. Kisan4u reserves the right to delist any seller found in violation of these regulations.",
        ],
      },
      {
        heading: "16. Changes to Terms and Conditions",
        paragraphs: [
          "Kisan4u may update these terms at any time, and users will be notified of significant changes. Continued use of the platform after modifications constitutes acceptance of the new terms.",
          "For any queries, contact us at support@kisan4u.com.",
        ],
      },
    ],
  },

  privacy: {
    slug: "privacy",
    href: "/privacy",
    title: "Privacy Policy",
    sections: [
      {
        heading: "1. Introduction",
        paragraphs: [
          'At www.kisan4u.com ("we," "our," "us"), we are committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website, use our services, or make purchases. By accessing or using our website, you agree to the terms of this Privacy Policy. The collection, processing, and storage of your data are in compliance with the Information Technology Act, 2000, and the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011.',
        ],
      },
      {
        heading: "2. Information We Collect",
        paragraphs: [
          "We collect both personal and non-personal information when you visit our website, create an account, place an order, subscribe to our newsletter, or interact with us. Personal information includes your name, email address, mailing address, phone number, payment details such as credit card information, and your date of birth, if applicable. Non-personal information includes your IP address, browser type and version, operating system, referring website, pages viewed, time and date of your visit, and other diagnostic data. This data collection aligns with Indian data protection regulations, which emphasize the necessity of lawful and fair processing of information.",
        ],
      },
      {
        heading: "3. How We Use Your Information",
        paragraphs: [
          "The information we collect is used for several purposes, including processing and fulfilling your orders, managing your account, and providing customer support. We may send you order confirmations, invoices, updates, and marketing communications if you have opted in to receive them. Additionally, we use the data to analyze website usage, identify trends, and enhance our services while taking appropriate measures to detect and prevent fraud. These practices comply with the IT Rules, 2011, which mandate that data should only be processed for legitimate purposes.",
        ],
      },
      {
        heading: "4. Sharing Your Information",
        paragraphs: [
          "We do not sell or trade your personal information to external parties. However, we may share your information with third-party service providers who assist us in areas such as technology development, payment processing, shipping, email delivery, and marketing. These service providers are contractually obligated to use your information solely for the services they provide and are required to follow the reasonable security practices outlined in the IT Act, 2000. We may also disclose your information to comply with legal obligations, including valid requests from courts or government agencies. In the event of a merger, acquisition, or sale of our business, your information may be transferred to the new owner to ensure continuity of service.",
        ],
      },
      {
        heading: "5. Data Security",
        paragraphs: [
          "We implement appropriate technical and organizational measures to protect your personal information from unauthorized access, use, or disclosure, in line with Section 43A of the IT Act, 2000. Despite our best efforts, it is important to understand that no method of electronic storage or internet transmission is entirely secure, and we cannot guarantee absolute security.",
        ],
      },
      {
        heading: "6. Cookies and Tracking Technologies",
        paragraphs: [
          "Our website uses cookies and similar tracking technologies to monitor activity and store certain information. Cookies are small data files sent to your browser and stored on your device to enhance your user experience. You can configure your browser to refuse all cookies or notify you when a cookie is being sent. However, disabling cookies may affect your ability to access certain parts of our website.",
        ],
      },
      {
        heading: "7. Your Rights",
        paragraphs: [
          "Under Indian data protection laws, you have the right to access, correct, update, delete, or restrict the processing of your personal information. You can also object to the processing of your data for certain purposes. To exercise any of these rights, please contact us at care@kisan4u.com. We are committed to addressing your requests promptly while complying with applicable legal requirements.",
        ],
      },
      {
        heading: "8. Account Deletion and Retention",
        paragraphs: [
          "You may request deletion from the Kisan4U app or at www.kisan4u.com/delete-account. After eligibility checks and a grace period, readable contact details, login credentials, saved addresses, carts, wishlists, notifications, and identity documents are removed or anonymized. Orders, payments, refunds, settlements, and invoices are retained for the period required by applicable law. A non-readable cryptographic fingerprint of a phone number or email may be retained for fraud and repeat-benefit prevention.",
        ],
      },
      {
        heading: "8. Third-Party Links",
        paragraphs: [
          "Our website may contain links to third-party websites. Please note that we are not responsible for the privacy practices or content of these websites. We encourage you to review the privacy policies of any third-party sites you visit to understand how they collect and process your data.",
        ],
      },
      {
        heading: "9. Changes to This Privacy Policy",
        paragraphs: [
          "We may update this Privacy Policy from time to time to reflect changes in our practices or to comply with legal requirements. Any updates will be posted on this page with an updated effective date. By continuing to use our website after such changes, you agree to the revised Privacy Policy.",
        ],
      },
      {
        heading: "10. Contact Us",
        paragraphs: [
          "If you have any questions or concerns about this Privacy Policy or our data protection practices, please contact us via email at care@kisan4u.com or at our office address: 1304, Marathon Icon, Nextgen Campus, Lower Parel (W), Mumbai 400013.",
          "Thank you for trusting www.kisan4u.com with your personal information. Your privacy is important to us, and we are committed to protecting it.",
        ],
      },
    ],
  },

  "return-policy": {
    slug: "return-policy",
    href: "/return-policy",
    title: "Return Policy",
    sections: [
      {
        heading: "1. Overview",
        paragraphs: [
          "At www.kisan4u.com, we are committed to delivering an exceptional customer experience. If, for any reason, you are not completely satisfied with your purchase, we offer a structured return process to assist you. This Return Policy outlines your rights, eligibility criteria, and the procedures to be followed for returning products purchased through our website. By initiating a return, you agree to comply with the terms and conditions set forth herein.",
        ],
      },
      {
        heading: "2. Eligibility for Returns",
        paragraphs: [
          "Products purchased from www.kisan4u.com may be eligible for return if the following conditions are met. Returns must be initiated within forty-eight (48) hours from the date of delivery as recorded in the shipment tracking information. To qualify for a return, the item must remain unused, in its original condition, and accompanied by all packaging, tags, and accessories as delivered. Items that show signs of use, damage, alteration, or are not in their original condition will not qualify for a return. We reserve the right to reject any return that does not meet these criteria.",
        ],
      },
      {
        heading: "3. Non-Returnable Items",
        paragraphs: [
          "Certain products are excluded from our return policy due to their nature. These include, but are not limited to, gift cards, downloadable software products, perishable goods (such as food, flowers, newspapers, or magazines), personal care items (including intimate or sanitary goods), and custom or personalized orders. These exclusions are final and non-negotiable.",
        ],
      },
      {
        heading: "4. Return Process",
        paragraphs: [
          "To initiate a return, you must contact our customer service team at return@kisan4u.com, providing your order number and a detailed explanation of the reason for the return. Upon receipt of your request, our team will evaluate the claim and, if approved, issue a return authorization number along with detailed instructions for returning the item. Items returned without prior authorization will not be accepted. You are responsible for ensuring that the item is securely packaged to prevent damage during transit.",
        ],
      },
      {
        heading: "5. Refunds",
        paragraphs: [
          "Upon receipt of the returned item, our team will conduct a thorough inspection to verify its condition and eligibility for refund. You will be notified of the status of your refund once the inspection is complete. Approved refunds will be processed to the original method of payment or credited to your wallet within four (4) to five (5) business days. In certain cases, partial refunds may be issued for items that do not fully meet our return criteria, including those returned in a damaged or altered state due to reasons not attributable to our error.",
        ],
      },
      {
        heading: "6. Exchanges",
        paragraphs: [
          "We offer exchanges only for items that are defective or damaged. If you receive a defective or damaged product, you may request an exchange for the same item by contacting us at return@kisan4u.com. Requests for exchanges must follow the same procedure as outlined in the Return Process. All exchanges are subject to product availability.",
        ],
      },
      {
        heading: "7. International Returns",
        paragraphs: [
          "For orders shipped internationally, all customs duties, taxes, and additional fees incurred during the return process are the sole responsibility of the customer and are non-refundable. Customers are also responsible for the cost of return shipping for international orders. We recommend using a trackable shipping method for international returns to ensure timely delivery and proper handling.",
        ],
      },
      {
        heading: "8. Contact Us",
        paragraphs: [
          "If you have any questions, concerns, or need further assistance with this Return Policy, please reach out to us using the following contact details:",
          "Email: care@kisan4u.com\nPhone: +91-98265-75663\nAddress: 1304, Marathon Icon, Nextgen Campus, Lower Parel (W), Mumbai 400013",
          "We value your trust and business, and we are committed to resolving any issues you may encounter promptly and professionally.",
        ],
      },
    ],
  },

  "cancellation-policy": {
    slug: "cancellation-policy",
    href: "/cancellation-policy",
    title: "Cancellation Policy",
    sections: [
      {
        paragraphs: [
          "At Kisan4u, we strive to provide the best experience for our customers. However, we understand that there may be situations where you need to cancel an order. Below are our cancellation guidelines.",
        ],
      },
      {
        heading: "Order Cancellation by Customer",
        paragraphs: [
          "Customers can cancel their order before it is dispatched from our warehouse, and a full refund will be processed to the original payment method. If the order has already been shipped, cancellation is not allowed. However, customers can refuse delivery, and the refund will be processed after deducting applicable shipping charges. Orders for customized, made-to-order, or perishable products cannot be cancelled once placed.",
        ],
      },
      {
        heading: "Order Cancellation by Kisan4u",
        paragraphs: [
          "Kisan4u reserves the right to cancel an order under certain circumstances. If the ordered item is out of stock or discontinued, if there is a failure in payment verification or an incomplete transaction, or if the order is suspected to be fraudulent or violates our terms and conditions, Kisan4u may cancel the order. In such cases, customers will be notified, and a full refund will be issued.",
        ],
      },
      {
        heading: "Refund Process",
        paragraphs: [
          "Refunds, if applicable, will be processed within 5–7 business days to the original payment source. In the case of Cash on Delivery (COD) orders, refunds will be credited to the customer's bank account or Kisan4u wallet after verifying the cancellation request.",
        ],
      },
      {
        heading: "How to Request Cancellation?",
        paragraphs: [
          "To cancel an order, customers can log in to their Kisan4u account, go to 'My Orders,' select the order, and click on 'Cancel Order' (if eligible). Alternatively, they can contact our Customer Support at support@kisan4u.com or +91 98265 75663 with the order details. For any queries regarding order cancellation, feel free to reach out to our Customer Support Team at support@kisan4u.com.",
        ],
      },
      {
        heading: "Changes to Terms and Conditions",
        paragraphs: [
          "Kisan4u may update these terms at any time, and users will be notified of significant changes. Continued use of the platform after modifications constitutes acceptance of the new terms.",
        ],
      },
    ],
  },

  "shipping-policy": {
    slug: "shipping-policy",
    href: "/shipping-policy",
    title: "Shipping Policy",
    sections: [
      {
        heading: "1. Overview",
        paragraphs: [
          "At www.kisan4u.com, we are committed to ensuring that your shopping experience is seamless and efficient, regardless of your location. This Shipping Policy sets forth the terms and conditions that govern the processing, shipping, and delivery of products purchased from our website. By placing an order with us, you agree to the terms outlined herein. For further information or clarification, please contact us using the details provided in Section 9 of this policy.",
        ],
      },
      {
        heading: "2. Processing Time",
        paragraphs: [
          "All orders placed through our website are processed within one (1) to four (4) business days, excluding weekends and public holidays. Orders received on non-business days will be processed on the following business day. In the event of a high volume of orders, processing times may be extended. We will make every effort to notify you of any significant delays via email or phone. Please note that processing time does not include transit time, which varies based on the selected shipping method and destination.",
        ],
      },
      {
        heading: "3. Shipping Rates and Delivery Estimates",
        paragraphs: [
          "Shipping charges for your order will be calculated and displayed during the checkout process. Delivery times are estimates and are not guaranteed, as they may be influenced by factors beyond our control, including weather, courier delays, and destination-specific considerations. Typical delivery estimates are as follows:",
          "In cases of delay, we will endeavour to provide timely updates regarding the status of your shipment.",
        ],
        list: [
          "Standard Shipping: Two (2) to six (6) business days.",
          "Expedited Shipping: Two (2) to four (4) business days.",
          "Overnight Shipping: One (1) to two (2) business days.",
        ],
      },
      {
        heading: "4. Shipping Confirmation and Order Tracking",
        paragraphs: [
          "Once your order has been shipped, you will receive a confirmation email containing the shipment details, including the tracking number(s). Tracking numbers are typically activated within twenty-four (24) hours of shipment. You may monitor the status of your order by visiting the tracking link provided in the confirmation email. If you experience difficulties accessing your tracking information, please contact us for assistance.",
        ],
      },
      {
        heading: "5. International Shipping",
        paragraphs: [
          "We offer international shipping to select countries, subject to availability and applicable restrictions. During the checkout process, you will be notified of the shipping options available for your destination. International orders may be subject to customs duties, taxes, and other fees, which are the sole responsibility of the customer. Kisan4u.com is not liable for any additional charges imposed by customs authorities or for delays resulting from customs clearance procedures. Estimated delivery times for international shipments may vary significantly based on the destination and applicable regulations.",
        ],
      },
      {
        heading: "6. Shipping Restrictions",
        paragraphs: [
          "We do not ship to P.O. boxes or addresses located in regions where courier services are unavailable. If your area is not serviceable, we will notify you promptly and work to identify alternative solutions, which may include cancellation of your order or redirection to a nearby serviceable location. You are responsible for providing a valid and complete physical address to facilitate successful delivery.",
        ],
      },
      {
        heading: "7. Damages and Missing Items",
        paragraphs: [
          "Kisan4u.com assumes no liability for products that are damaged, lost, or tampered with during shipping. In the event you receive a damaged product, please refer to our Return Policy for instructions on initiating a return or exchange. For missing items, you must notify us within seven (7) calendar days of receiving your shipment. Please provide your order number and a detailed description of the missing items when contacting us at care@kisan4u.com. We will investigate the matter and provide a resolution in accordance with our policies.",
        ],
      },
      {
        heading: "8. Returns and Exchanges",
        paragraphs: [
          "For information regarding the return or exchange of shipped products, please consult our Return Policy, which outlines the eligibility criteria, procedures, and timelines for returns and refunds.",
        ],
      },
      {
        heading: "9. Contact Information",
        paragraphs: [
          "If you have questions or require assistance regarding this Shipping Policy, you may contact us via the following methods:",
          "Email: shipping@kisan4u.com\nPhone: +91-98265-75663\nAddress: 1304, Marathon Icon, Nextgen Campus, Lower Parel (W), Mumbai 400013",
          "We value your business and are committed to providing an exceptional level of service. Please do not hesitate to reach out to us with any concerns or feedback.",
        ],
      },
    ],
  },

  contact: {
    slug: "contact",
    href: "/contact",
    title: "Contact Us",
    sections: [
      {
        paragraphs: [
          "We're here to help. Reach the Kisan4U team using any of the details below and we'll get back to you as soon as we can.",
        ],
      },
      {
        heading: "Registered Office",
        paragraphs: [
          "Kisan4u Marketing Pvt. Ltd.\n1304, Marathon Icon, NextGen Campus,\nOpp. Peninsula Corporate Park,\nLower Parel (West), Mumbai – 400013\nIndia",
        ],
      },
      {
        heading: "Phone",
        paragraphs: ["+91 98265 75663"],
      },
      {
        heading: "Email",
        paragraphs: [
          "General support: support@kisan4u.com\nReturns & exchanges: return@kisan4u.com\nShipping queries: shipping@kisan4u.com\nPrivacy & data requests: care@kisan4u.com",
        ],
      },
    ],
  },
};

export const LEGAL_LINKS: { slug: LegalSlug; label: string; href: string }[] = LEGAL_SLUGS.map(
  (slug) => ({ slug, label: LEGAL_DOCS[slug].title, href: LEGAL_DOCS[slug].href }),
);

export function isLegalSlug(value: string): value is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(value);
}
