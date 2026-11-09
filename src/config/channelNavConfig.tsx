import { 
  LayoutDashboard, Plane, Calculator, FileText, Utensils, DollarSign,
  Shield, AlertTriangle, MoreHorizontal, FileBarChart2, ScrollText,
  ShieldCheck, Users, Bell, Settings, ClipboardCheck, Building2,
  Receipt, CreditCard, Eye, Landmark
} from "lucide-react";
import type { Channel } from "@/contexts/ChannelContext";

interface NavChild {
  label: string;
  path: string;
}

interface NavSection {
  label: string;
  icon: React.ReactNode;
  children?: NavChild[];
  path?: string;
  collapsible?: boolean;
}

const TREASURY_SECTION: NavSection = {
  label: "TREASURY", icon: <Landmark size={18} />, collapsible: true,
  children: [
    { label: "Treasury Overview", path: "/treasury" },
    { label: "Bank Accounts", path: "/treasury/bank-accounts" },
    { label: "Cash Accounts", path: "/treasury/cash-accounts" },
    { label: "Receipt Vouchers", path: "/accounting/treasury-vouchers?tab=receipt" },
    { label: "Payment Vouchers", path: "/accounting/treasury-vouchers?tab=general" },
    { label: "Bank Transfers", path: "/treasury/bank-transfers" },
    { label: "Bank Reconciliation", path: "/treasury/bank-reconciliation" },
  ],
};

// Channel-specific navigation configs
const channelNavs: Record<Channel, NavSection[]> = {
  clearance: [
    { label: "Dashboard", icon: <LayoutDashboard size={18} />, path: "/" },
    {
      label: "CLEARANCE", icon: <ShieldCheck size={18} />, collapsible: true,
      children: [
        { label: "Flight Schedules", path: "/clearances" },
        { label: "Overfly Schedule", path: "/overfly-schedule" },
      ],
    },
    {
      label: "REFERENCE", icon: <MoreHorizontal size={18} />, collapsible: true,
      children: [
        { label: "Airlines", path: "/airlines" },
        { label: "Aircrafts", path: "/aircrafts" },
        { label: "Vehicles", path: "/vehicles" },
        { label: "Aircraft Types", path: "/aircraft-types" },
        { label: "Airports", path: "/airports" },
      ],
    },
    { label: "NOTIFICATIONS", icon: <Bell size={18} />, path: "/notifications" },
  ],

  station: [
    { label: "Dashboard", icon: <LayoutDashboard size={18} />, path: "/" },
    {
      label: "SERVICE REPORT", icon: <FileBarChart2 size={18} />, collapsible: true,
      children: [
        { label: "Service Reports", path: "/service-report" },
      ],
    },
    {
      label: "REPORTING", icon: <FileBarChart2 size={18} />, collapsible: true,
      children: [
        { label: "Service Reports", path: "/service-report" },
        { label: "Irregularity Reports", path: "/irregularity-reports" },
        { label: "Lost & Found", path: "/lost-found" },
        { label: "Delay Codes", path: "/delay-codes" },
      ],
    },
    { label: "NOTIFICATIONS", icon: <Bell size={18} />, path: "/notifications" },
  ],

  contracts: [
    { label: "Dashboard", icon: <LayoutDashboard size={18} />, path: "/" },
    {
      label: "CONTRACTS", icon: <FileText size={18} />, collapsible: true,
      children: [
        { label: "Contracts", path: "/contracts" },
        { label: "Airline Incentives", path: "/airline-incentives" },
      ],
    },
    {
      label: "PRICING", icon: <DollarSign size={18} />, collapsible: true,
      children: [
        { label: "Chart of Services", path: "/services" },
        { label: "Airport Charges", path: "/airport-charges" },
        { label: "Departure Tax", path: "/airport-tax" },
        { label: "Basic Ramp", path: "/basic-ramp" },
        { label: "Vendor Equipment", path: "/vendor-equipment" },
        { label: "Hall & VVIP", path: "/hall-vvip" },
        { label: "Tube", path: "/tube" },
        { label: "Catering", path: "/catering" },
      ],
    },
    {
      label: "REFERENCE", icon: <MoreHorizontal size={18} />, collapsible: true,
      children: [
        { label: "Airlines", path: "/airlines" },
        { label: "Service Providers", path: "/service-providers" },
      ],
    },
    { label: "NOTIFICATIONS", icon: <Bell size={18} />, path: "/notifications" },
  ],

  operations: [
    { label: "Dashboard", icon: <LayoutDashboard size={18} />, path: "/" },
    {
      label: "REVIEW", icon: <ClipboardCheck size={18} />, collapsible: true,
      children: [
        { label: "Service Reports", path: "/service-report" },
        { label: "Reports", path: "/operations-reports" },
      ],
    },
    {
      label: "OPERATIONS", icon: <Plane size={18} />, collapsible: true,
      children: [
        { label: "Countries", path: "/countries" },
        { label: "Airports", path: "/airports" },
        { label: "Airlines", path: "/airlines" },
        { label: "Aircrafts", path: "/aircrafts" },
        { label: "Vehicles", path: "/vehicles" },
        { label: "Staff Roster", path: "/staff-roster" },
      ],
    },
    {
      label: "QUALITY & SAFETY", icon: <AlertTriangle size={18} />, collapsible: true,
      children: [
        { label: "Irregularity Reports", path: "/irregularity-reports" },
        { label: "Bulletins", path: "/bulletins" },
        { label: "Manuals & Forms", path: "/manuals-forms" },
      ],
    },
    { label: "NOTIFICATIONS", icon: <Bell size={18} />, path: "/notifications" },
  ],

  receivables: [
    { label: "Dashboard", icon: <LayoutDashboard size={18} />, path: "/" },
    {
      label: "BILLING", icon: <Receipt size={18} />, collapsible: true,
      children: [
        { label: "Client Invoices", path: "/invoices" },
        { label: "Service Report", path: "/service-report" },
        { label: "Aging Reports", path: "/aging-reports" },
      ],
    },
    
    {
      label: "REFERENCE", icon: <MoreHorizontal size={18} />, collapsible: true,
      children: [
        { label: "Airlines", path: "/airlines" },
      ],
    },
    { label: "NOTIFICATIONS", icon: <Bell size={18} />, path: "/notifications" },
  ],

  payables: [
    { label: "Dashboard", icon: <LayoutDashboard size={18} />, path: "/" },
    {
      label: "PAYABLES", icon: <CreditCard size={18} />, collapsible: true,
      children: [
        { label: "Vendor Invoices", path: "/vendor-invoices" },
        { label: "Service Providers", path: "/service-providers" },
        { label: "Aging Reports", path: "/aging-reports" },
      ],
    },
    {
      label: "RECEIVABLES (READ-ONLY)", icon: <Eye size={18} />, collapsible: true,
      children: [
        { label: "Client Invoices", path: "/invoices" },
      ],
    },
    {
      label: "PRICING", icon: <DollarSign size={18} />, collapsible: true,
      children: [
        { label: "Airport Charges", path: "/airport-charges" },
        { label: "Vendor Equipment", path: "/vendor-equipment" },
      ],
    },
    TREASURY_SECTION,
    { label: "NOTIFICATIONS", icon: <Bell size={18} />, path: "/notifications" },
  ],

  general_accounts: [
    { label: "Dashboard", icon: <LayoutDashboard size={18} />, path: "/" },
    {
      label: "PAYABLES", icon: <CreditCard size={18} />, collapsible: true,
      children: [
        { label: "Vendor Invoices", path: "/vendor-invoices" },
        { label: "Service Providers", path: "/service-providers" },
        { label: "Aging Reports", path: "/aging-reports" },
      ],
    },
    {
      label: "ACCOUNTANT", icon: <Calculator size={18} />, collapsible: true,
      children: [
        { label: "Chart of Accounts", path: "/chart-of-accounts" },
        { label: "Journal Entries", path: "/journal-entries" },
        { label: "Client Invoices", path: "/invoices" },
        { label: "Vendor Invoices", path: "/vendor-invoices" },
        { label: "Aging Reports", path: "/aging-reports" },
        { label: "Financial Reports", path: "/financial-reports" },
        { label: "Cost Center Reports", path: "/accounting/cost-center" },
        { label: "FX Revaluation", path: "/accounting/fx-revaluation" },
        { label: "VAT Return", path: "/accounting/vat-return" },
        { label: "Recurring Entries", path: "/accounting/recurring-journals" },
        { label: "Budgets & Variance", path: "/accounting/budgets" },
        { label: "Fixed Assets", path: "/accounting/fixed-assets" },
        { label: "Fixed Assets — Advanced", path: "/accounting/fixed-assets-advanced" },
        { label: "Depreciation Scheduler", path: "/accounting/depreciation" },
        { label: "Accruals & Deferrals", path: "/accounting/accruals" },
        { label: "Cost Allocation", path: "/accounting/cost-allocation" },
        { label: "Budget vs Actual", path: "/accounting/budget-variance" },
        { label: "Cash Flow Statement", path: "/accounting/cash-flow" },
        { label: "Cash Flow Forecast (13w)", path: "/accounting/cash-flow-forecast" },
        { label: "Bank Reconciliation", path: "/accounting/bank-reconciliation" },
        { label: "Collections Workflow", path: "/accounting/collections" },
        { label: "Consolidation Workbench", path: "/accounting/consolidation-workbench" },
        { label: "Financial Ratios & KPIs", path: "/accounting/financial-ratios" },
        { label: "Tax Compliance Center", path: "/accounting/tax-compliance" },
        { label: "Recurring Invoices", path: "/accounting/recurring-invoices" },
        { label: "FX Gain / Loss", path: "/accounting/fx-gain-loss" },
        { label: "Contracts & Renewals", path: "/accounting/contracts-renewals" },
        { label: "Vendor Portal", path: "/accounting/vendor-portal" },
        { label: "Consolidated Statements", path: "/accounting/consolidated" },
        { label: "Partner Statements", path: "/accounting/statements" },
        { label: "Intercompany", path: "/accounting/intercompany" },
        { label: "Approval Workflows", path: "/accounting/approvals" },
        { label: "Tax Withholding", path: "/accounting/wht" },
        { label: "Cheque Management", path: "/accounting/cheques" },
        { label: "Petty Cash", path: "/accounting/petty-cash" },
        { label: "Notes Payable & Loans", path: "/accounting/notes-payable" },
        { label: "Objections & Variance", path: "/accounting/objections" },
        { label: "Financial Statements", path: "/accounting/financial-statements" },
        { label: "Treasury Vouchers", path: "/accounting/treasury-vouchers" },
        { label: "Audit Log", path: "/accounting/audit-log" },
        { label: "Reports / Admin", path: "/reports-admin" },
        { label: "Airline Incentives", path: "/airline-incentives" },
      ],
    },
    {
      label: "ACCOUNTING SETUP", icon: <Building2 size={18} />, collapsible: true,
      children: [
        { label: "Companies", path: "/accounting/companies" },
        { label: "Finance Stations", path: "/accounting/stations" },
        { label: "Customer Price List", path: "/accounting/customer-prices" },
        { label: "Supplier Price List", path: "/accounting/supplier-prices" },
        { label: "Exchange Rates", path: "/accounting/exchange-rates" },
      ],
    },
    TREASURY_SECTION,
    {
      label: "REFERENCE", icon: <MoreHorizontal size={18} />, collapsible: true,
      children: [
        { label: "Airlines", path: "/airlines" },
      ],
    },
    { label: "NOTIFICATIONS", icon: <Bell size={18} />, path: "/notifications" },
  ],
  admin: [
    { label: "Dashboard", icon: <LayoutDashboard size={18} />, path: "/" },
    {
      label: "CLEARANCE", icon: <ShieldCheck size={18} />, collapsible: true,
      children: [
        { label: "Flight Schedules", path: "/clearances" },
        { label: "Overfly Schedule", path: "/overfly-schedule" },
      ],
    },
    {
      label: "OPERATION", icon: <Plane size={18} />, collapsible: true,
      children: [
        { label: "Service Reports", path: "/service-report" },
        { label: "Countries", path: "/countries" },
        { label: "Airports", path: "/airports" },
        { label: "Airlines", path: "/airlines" },
        { label: "Aircrafts", path: "/aircrafts" },
        { label: "Vehicles", path: "/vehicles" },
        { label: "Services Catalog", path: "/services-catalog" },
        { label: "Service Providers", path: "/service-providers" },
        { label: "Delay Codes", path: "/delay-codes" },
        { label: "Lost & Found", path: "/lost-found" },
        { label: "Staff Roster", path: "/staff-roster" },
      ],
    },
    {
      label: "ACCOUNTANT", icon: <Calculator size={18} />, collapsible: true,
      children: [
        { label: "Chart of Accounts", path: "/chart-of-accounts" },
        { label: "Journal Entries", path: "/journal-entries" },
        { label: "Client Invoices", path: "/invoices" },
        { label: "Vendor Invoices", path: "/vendor-invoices" },
        { label: "Aging Reports", path: "/aging-reports" },
        { label: "Financial Reports", path: "/financial-reports" },
        { label: "Cost Center Reports", path: "/accounting/cost-center" },
        { label: "FX Revaluation", path: "/accounting/fx-revaluation" },
        { label: "VAT Return", path: "/accounting/vat-return" },
        { label: "Recurring Entries", path: "/accounting/recurring-journals" },
        { label: "Budgets & Variance", path: "/accounting/budgets" },
        { label: "Fixed Assets", path: "/accounting/fixed-assets" },
        { label: "Depreciation Scheduler", path: "/accounting/depreciation" },
        { label: "Accruals & Deferrals", path: "/accounting/accruals" },
        { label: "Cost Allocation", path: "/accounting/cost-allocation" },
        { label: "Budget vs Actual", path: "/accounting/budget-variance" },
        { label: "Cash Flow Statement", path: "/accounting/cash-flow" },
        { label: "Consolidated Statements", path: "/accounting/consolidated" },
        { label: "Partner Statements", path: "/accounting/statements" },
        { label: "Intercompany", path: "/accounting/intercompany" },
        { label: "Approval Workflows", path: "/accounting/approvals" },
        { label: "Tax Withholding", path: "/accounting/wht" },
        { label: "Cheque Management", path: "/accounting/cheques" },
        { label: "Petty Cash", path: "/accounting/petty-cash" },
        { label: "Notes Payable & Loans", path: "/accounting/notes-payable" },
        { label: "Objections & Variance", path: "/accounting/objections" },
        { label: "Financial Statements", path: "/accounting/financial-statements" },
        { label: "Treasury Vouchers", path: "/accounting/treasury-vouchers" },
        { label: "Audit Log", path: "/accounting/audit-log" },
        { label: "Reports / Admin", path: "/reports-admin" },
        { label: "Airline Incentives", path: "/airline-incentives" },
      ],
    },
    {
      label: "ACCOUNTING SETUP", icon: <Building2 size={18} />, collapsible: true,
      children: [
        { label: "Companies", path: "/accounting/companies" },
        { label: "Finance Stations", path: "/accounting/stations" },
        { label: "Customer Price List", path: "/accounting/customer-prices" },
        { label: "Supplier Price List", path: "/accounting/supplier-prices" },
        { label: "Exchange Rates", path: "/accounting/exchange-rates" },
      ],
    },
    TREASURY_SECTION,
    {
      label: "CONTRACT", icon: <FileText size={18} />, collapsible: true,
      children: [{ label: "Contracts", path: "/contracts" }],
    },
    { label: "CATERING", icon: <Utensils size={18} />, path: "/catering" },
    {
      label: "PRICES", icon: <DollarSign size={18} />, collapsible: true,
      children: [
        { label: "Tube", path: "/tube" },
        { label: "Airport Charges", path: "/airport-charges" },
        { label: "Departure Tax", path: "/airport-tax" },
        { label: "Basic Ramp", path: "/basic-ramp" },
        { label: "Vendor Equipment", path: "/vendor-equipment" },
        { label: "Hall & VVIP", path: "/hall-vvip" },
        { label: "Chart of Services", path: "/services" },
      ],
    },
    { label: "SERVICE REPORT", icon: <FileBarChart2 size={18} />, path: "/service-report" },
    { label: "T2 (TRAFFIC RIGHTS)", icon: <Shield size={18} />, path: "/traffic-rights" },
    {
      label: "QUALITY & SAFETY", icon: <AlertTriangle size={18} />, collapsible: true,
      children: [
        { label: "Irregularity Reports", path: "/irregularity-reports" },
        { label: "Bulletins", path: "/bulletins" },
        { label: "Manuals & Forms", path: "/manuals-forms" },
      ],
    },
    {
      label: "MISC.", icon: <MoreHorizontal size={18} />, collapsible: true,
      children: [
        { label: "Abbreviations", path: "/abbreviations" },
        { label: "Aircraft Types", path: "/aircraft-types" },
      ],
    },
    { label: "NOTIFICATIONS", icon: <Bell size={18} />, path: "/notifications" },
    { label: "SETTINGS", icon: <Settings size={18} />, path: "/settings" },
    { label: "USERS", icon: <Users size={18} />, path: "/users" },
    { label: "AUDIT LOG", icon: <ScrollText size={18} />, path: "/audit-log" },
    { label: "SECURITY STATUS", icon: <Shield size={18} />, path: "/security-status" },
  ],
};

export function getNavForChannel(channel: Channel): NavSection[] {
  return channelNavs[channel] || channelNavs.admin;
}

export type { NavSection, NavChild };
