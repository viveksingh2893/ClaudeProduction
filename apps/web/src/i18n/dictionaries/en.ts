/**
 * English is the canonical dictionary — its shape is the `Dictionary` type
 * every other language must satisfy, and every key here is the fallback
 * when another language is missing that key (see makeT in ../translate.ts).
 *
 * This covers the storefront chrome (ribbon, nav, footer, homepage section
 * titles, product-page tab labels). Page-body copy is translated
 * incrementally; a missing key renders the English string, never a blank.
 */
export const en = {
  ribbon: {
    becomeDealer: "Become a Dealer",
    corporateWebsite: "Corporate Website",
    language: "Language",
    chooseLanguage: "Choose language",
  },
  nav: {
    home: "Home",
    products: "Products",
    wishlist: "Wishlist",
    cart: "Cart",
    orders: "Orders",
    account: "Account",
    login: "Login",
    productRequests: "Product Requests",
    alerts: "Alerts",
    notifications: "Notifications",
    categories: "Categories",
    doctor: "Doctor",
    comingSoon: "Coming soon",
    search: "Search for products, brands and more",
    signOut: "Sign out",
  },
  doctorPage: {
    title: "Kisan4U Doctor coming soon",
    subtitle: "Stay tuned",
  },
  home: {
    bestSellers: "Best Sellers",
    trendingNow: "Trending Now",
    shopByBrand: "Shop by Brand",
    shopByCrop: "Shop by Crop",
    shopByPestDisease: "Shop by Pest & Disease",
    viewAll: "View all",
  },
  pdp: {
    description: "Description",
    ingredients: "Ingredients",
    howToUse: "How to Use",
    dosage: "Dosage",
    technicalInfo: "Technical Information",
    addToCart: "Add to Cart",
    buyNow: "Buy Now",
    outOfStock: "Out of Stock",
  },
  footer: {
    tagline:
      "A multi-seller marketplace for agri inputs and general goods — dealer/wholesale first, retail for everyone.",
    customerCare: "Customer care",
    shop: "Shop",
    legal: "Legal",
    more: "More",
    allProducts: "All Products",
    trackOrder: "Track Order",
    becomeDealer: "Become a Dealer",
    becomeSeller: "Become a Seller",
    rightsReserved: "All rights reserved.",
  },
  account: {
    welcome: "Welcome",
    welcomeName: "Welcome, {name}",
    loggedInAs: "Logged in as {role}",
    roleCustomer: "Customer",
    roleDealer: "Dealer",
    browseProducts: "Browse Products",
    dealerCatalogue: "Dealer Catalogue",
    myRequests: "My Requests",
    cart: "Cart",
    myOrders: "My Orders",
    savedAddresses: "Saved Addresses",
    wallet: "Kisan4U Wallet",
    profile: "Profile",
    businessAssociate: "Business Associate",
    walletBalance: "Kisan4U Wallet balance",
    manageWallet: "Manage wallet",
  },
  cookieConsent: {
    title: "We use cookies",
    message: "We use cookies, including Meta (Facebook) cookies, to understand how you use Kisan4U and to show you relevant offers. You can change this any time from Cookie settings in the footer.",
    accept: "Accept",
    decline: "Decline",
    privacy: "Privacy policy",
    settings: "Cookie settings",
  },
};

/** The dictionary shape every language must provide (string values, from `en`). */
export type Dictionary = typeof en;
