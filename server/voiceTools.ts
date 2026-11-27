import { Type, type FunctionDeclaration } from '@google/genai';

export interface VoiceWorkspaceContext {
  activeTab: string;
  isMainOwner: boolean;
  actorLabel: string;
  todayIst: string;
  currentMonthKey: string;
  branches: Array<{ branchId: string; branchCode: string; branchName: string }>;
  departments: Array<{ id: string; name: string }>;
  nonSalesDepartments: string[];
  employeeCount: number;
  activeEmployeeCount: number;
  availableIncentiveMonths: string[];
  availableSalaryMonths: string[];
  lockedMonths: string[];
  folderLinked: boolean;
  folderName: string;
  folderFiles: string[];
}

export function buildMarathiAssistantSystemInstruction(ctx: VoiceWorkspaceContext): string {
  const branchList = ctx.branches
    .map((b) => `${b.branchName} (id: ${b.branchId}, code: ${b.branchCode})`)
    .join('; ');
  const deptList = ctx.departments.map((d) => `${d.name} (id: ${d.id})`).join('; ');
  const filesPreview =
    ctx.folderLinked && ctx.folderFiles.length > 0
      ? ctx.folderFiles.slice(0, 60).join(', ')
      : ctx.folderLinked
        ? '(No .xlsx or .csv files found inside linked folder)'
        : '(Folder NOT linked yet)';

  return [
    `You are "मुक्ताई" (Muktai), the official FEMALE (महिला) Marathi Voice Office Assistant for "House of Muktai — Employee Incentive & Payroll Management System" (SHRIMUKTAI MART PRIVATE LIMITED).`,
    ``,
    `CORE PERSONA & STRICT FEMININE MARATHI GRAMMAR RULES (MANDATORY):`,
    `- Understand Marathi, Hindi, English, and mixed Marathi-English (Minglish/Hinglish) effortlessly (e.g., "1136 cha department saree kr", "Desktop varil oct file Oct-2026 madhe upload kar", "Dharashiv branch che top performers sang").`,
    `- ALWAYS speak as a warm, polite, confident FEMALE Marathi office assistant ("मुक्ताई"). EVERY SINGLE sentence where you refer to yourself MUST strictly use FEMININE Marathi first-person grammar (स्त्रीलिंगी क्रियापदे):`,
    `  * CORRECT (ALWAYS USE): "मी तुमची काय मदत करू शकते?", "मी आताच तपासते", "मी माहिती शोधते", "मी लगेच दाखवते", "मी बदल करते", "मी सेव्ह करते", "मी पाठवते", "मी रिपोर्ट तयार करते", "मी फाईल अपलोड करते", "मी तयार आहे", "मी तुम्हाला सांगते".`,
    `  * FORBIDDEN (NEVER USE MASCULINE VERBS): NEVER say "करू शकतो", "करतो", "तपासतो", "दाखवतो", "सांगतो", "शोधतो", "बघतो", "पाठवतो", "घेतो", "देतो", "सेव्ह करतो", "अपलोड करतो", "बदलतो", "आलो", "गेलो".`,
    `- ALWAYS reply in clean, natural, warm, conversational Devanagari Marathi (polite feminine tone, NEVER robotic or literal textbook translation, NEVER raw technical errors or JSON/stack traces).`,
    `- Keep every spoken reply crisp and reassuring: ideally 1 to 2 short sentences.`,
    `- When an action succeeds, confirm the key detail clearly in a warm feminine tone, e.g.: "कर्मचारी क्रमांक ११३६ यांचे डिपार्टमेंट साडी डिपार्टमेंट आणि शाखा धाराशिव करून मी सेव्ह केले आहे. आणखी काही मदत हवी असेल तर सांगा, मी तयार आहे."`,
    `- When using numbers in Marathi speech, natural numerals or Devanagari numerals both work; prefer clean readable Marathi phrasing (e.g., ₹१२,५०० किंवा रुपये 12,500).`,
    ``,
    `EXECUTION & SAFETY RULES:`,
    `- IMMEDIATE ACTION: For normal tasks (search, filter, navigate, add, edit, update, mark payout, add adjustment, upload Excel, calculate totals, download report), invoke the appropriate tool(s) IMMEDIATELY without asking unnecessary confirmation.`,
    `- DESTRUCTIVE ACTION LOCK: Before permanently deleting an employee, branch, batch, month records, salary slips, payouts, adjustments, queries, targets, or loans, NEVER pass confirmed=true unless the user explicitly confirmed in the latest turn ("हो", "होय", "yes", "confirm", "कर", "डिलीट कर"). First check the target record(s) (or call the delete tool with confirmed=false), state clearly in Marathi what will be deleted, and ask for quick verbal confirmation ("हो" किंवा "नाही").`,
    `- ROLE AWARENESS: Current logged-in user is ${ctx.isMainOwner ? 'MAIN OWNER (full edit, update, delete & governance rights)' : 'SUPER ADMIN (daily operations; permanent deletes & payroll lock require Main Owner login)'}. If a Super Admin asks for an Owner-only permanent delete or lock change, explain politely in Marathi that this action requires Main Owner access.`,
    `- AMBIGUITY & ERROR HANDLING: If a name matches multiple employees, list their Employee IDs, full names, and branches and ask in Marathi which one to update. If a local folder is not linked when uploading an Excel file, guide them politely: "आधी वरच्या 'Link Local Folder' बटणावर क्लिक करून फोल्डर जोडा, मग मी फाईल लगेच अपलोड करते." If a file isn't found, suggest the closest available files from the folder. If an Excel column or row fails validation, explain the exact column/row issue in simple Marathi and how to fix it.`,
    `- DEVANAGARI TO ENGLISH TOOL PARAMETERS: Employee names and branch names in the database are stored in English/Latin script (e.g., "SHOBHA LONDHE", "DHARASHIV", "BARAMATI MIDC"). When the user speaks a name in Marathi/Devanagari (e.g., "शोभा लोंढे", "धाराशिव"), ALWAYS pass the clean English/Latin spelling in tool parameters (e.g., query: "Shobha Londhe", branch: "Dharashiv"). When the user asks for information about a specific employee, call search_employees with openInUi: true and summarize their ID, branch, department, designation, status, phone, and latest incentive/salary concisely in Marathi.`,
    `- MULTI-STEP CHAINED COMMANDS: When the user asks for multiple actions in ONE sentence (e.g., "धाराशिव शाखेतील सर्व साडी डिपार्टमेंटच्या कर्मचाऱ्यांचा ऑक्टोबरचा पगार PAID करा आणि रिपोर्ट डाउनलोड करा", or "११३६ चे डिपार्टमेंट साडी करा आणि त्यांची WhatsApp स्लिप तयार करा"), execute ALL requested steps sequentially or in parallel until EVERY step is complete, and then confirm all completed steps together in one clear Marathi summary.`,
    `- WHATSAPP & EXECUTIVE BRIEFING PRO TOOLS: Whenever the user asks to send/share a Salary Slip or Incentive message on WhatsApp (for 1 employee OR a whole branch/department), call prepare_whatsapp_dispatch DIRECTLY with employeeIdentifier (English/Latin name like "Shobha Londhe" or Employee ID) — DO NOT call search_employees first because prepare_whatsapp_dispatch already resolves names and IDs automatically! Whenever the user asks for a morning/daily/monthly business report, CEO summary, or "आजचा बिझनेस रिपोर्ट सांग", call get_executive_briefing directly.`,
    `- NEVER invent or guess data. Always call the tool to read, search, calculate, or mutate real workspace data.`,
    ``,
    `LIVE WORKSPACE CONTEXT:`,
    `- Today (IST): ${ctx.todayIst} | Current Month Key: ${ctx.currentMonthKey}`,
    `- Active Tab: ${ctx.activeTab}`,
    `- Total Employees: ${ctx.employeeCount} (Active: ${ctx.activeEmployeeCount})`,
    `- Official Branches: ${branchList || 'None loaded'}`,
    `- Official Sales Departments: ${deptList}`,
    `- Non-Sales Departments: ${ctx.nonSalesDepartments.join(', ')}`,
    `- Incentive Months Available: ${ctx.availableIncentiveMonths.join(', ') || 'None'}`,
    `- Salary Slip Months Available: ${ctx.availableSalaryMonths.join(', ') || 'None'}`,
    `- Locked Payroll Months: ${ctx.lockedMonths.join(', ') || 'None'}`,
    `- Local Folder Status: ${ctx.folderLinked ? `LINKED ("${ctx.folderName}", ${ctx.folderFiles.length} spreadsheet file(s))` : 'NOT LINKED'}`,
    `- Linked Folder Files: ${filesPreview}`,
  ].join('\n');
}

export const VOICE_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'navigate_to_section',
    description:
      'Switch the active Admin Panel page/tab or open global modals (Search, Training PPT). Use whenever user asks to open a page or view a section.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        tab: {
          type: Type.STRING,
          description:
            'Target tab ID: overview, import, employees, branches, payouts, salary, branch-reports, analytics, pro-suite, history, owner-access',
        },
        modal: {
          type: Type.STRING,
          description: 'Optional modal to open: search, training_ppt, change_password, none',
        },
      },
      required: ['tab'],
    },
  },
  {
    name: 'filter_workspace',
    description:
      'Apply or clear live UI table filters (search query, branch, department, status, monthKey, subTab) on Employees, Salary Slips, Payouts & Queries, History & Reports, or Branch Reports, and automatically switch to that tab so the user sees filtered rows immediately.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetTab: {
          type: Type.STRING,
          description:
            'Which screen to filter: employees, salary, payouts, history, branch-reports',
        },
        branch: {
          type: Type.STRING,
          description: 'Branch name, code, or ID (e.g., "Dharashiv", "BARAMATI_MIDC", or "ALL")',
        },
        department: {
          type: Type.STRING,
          description:
            'Department ID or name (e.g., "SAREE", "LADIES_WEAR", "KIDS_WEAR", "MENS_WEAR", "NON_APPARELS", "UNASSIGNED", "NON_SALES", or "ALL")',
        },
        status: {
          type: Type.STRING,
          description: 'Status filter (e.g., ACTIVE, INACTIVE, PAID, UNPAID, APPROVED, OPEN, RESOLVED, ALL)',
        },
        monthKey: {
          type: Type.STRING,
          description: 'Target month in YYYY-MM format (e.g., "2026-10") or "ALL"',
        },
        searchQuery: {
          type: Type.STRING,
          description: 'Free-text search term (employee number, name, phone, batch name, etc.)',
        },
        subTab: {
          type: Type.STRING,
          description: 'Optional sub-tab (e.g., payouts/adjustments/queries on payouts screen)',
        },
        clearFilters: {
          type: Type.BOOLEAN,
          description: 'Set true to reset all filters on the target screen back to ALL/empty',
        },
      },
      required: ['targetTab'],
    },
  },
  {
    name: 'search_employees',
    description:
      'Search employees by employee ID, Sale ID, name (exact or partial), branch, department, or status. Use to inspect employee details or disambiguate before editing/deleting.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Employee ID, Sale ID, or full/partial employee name',
        },
        branch: {
          type: Type.STRING,
          description: 'Optional branch name/code filter',
        },
        department: {
          type: Type.STRING,
          description: 'Optional department name/ID filter',
        },
        status: {
          type: Type.STRING,
          description: 'Optional status filter: ACTIVE, INACTIVE, or ALL',
        },
        openInUi: {
          type: Type.BOOLEAN,
          description: 'If true, also navigates to Employees tab and filters UI to show the result',
        },
      },
    },
  },
  {
    name: 'add_employee',
    description:
      'Add a brand new employee to Employee Master and save directly to Firestore. Generates Login ID automatically if omitted.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        employeeId: { type: Type.STRING, description: 'Unique Employee ID / Staff Code (e.g., "1450")' },
        fullName: { type: Type.STRING, description: 'Full employee name' },
        branch: { type: Type.STRING, description: 'Branch name or code (e.g., "Dharashiv", "Baramati MIDC")' },
        department: {
          type: Type.STRING,
          description: 'Sales department (Saree, Ladies Wear, Kids Wear, Mens Wear, Non Apparels) or custom department (Accounts, HR & Admin, etc.)',
        },
        designation: { type: Type.STRING, description: 'Job title/designation (default: "Sales Executive")' },
        saleId: { type: Type.STRING, description: 'Optional POS Sale ID' },
        phone: { type: Type.STRING, description: 'Optional 10-digit mobile number' },
        gender: { type: Type.STRING, description: 'Optional gender (Male/Female)' },
        dateOfBirth: { type: Type.STRING, description: 'Optional DOB (YYYY-MM-DD)' },
        dateOfJoining: { type: Type.STRING, description: 'Optional DOJ (YYYY-MM-DD)' },
        baseSalaryRupees: { type: Type.NUMBER, description: 'Optional base salary in rupees (saved in Base Salary custom field)' },
        status: { type: Type.STRING, description: 'ACTIVE or INACTIVE (default ACTIVE)' },
      },
      required: ['employeeId', 'fullName', 'branch'],
    },
  },
  {
    name: 'update_employee',
    description:
      'Edit ANY field of an existing employee (Department, Branch/Location, Designation, Full Name, Phone, Sale ID, Base Salary, Gender, Category, DOB, DOJ, PAN, UAN, PF, ESIC, Bank Name/Account/IFSC, Address, Emergency Contact, Branch Manager flag, or ACTIVE/INACTIVE Status) and save to database immediately.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        employeeIdentifier: {
          type: Type.STRING,
          description: 'Employee ID, Sale ID, or exact/partial Name of the employee to update',
        },
        fullName: { type: Type.STRING, description: 'Updated full name' },
        branch: { type: Type.STRING, description: 'Updated branch name or code (transfers employee cleanly)' },
        department: {
          type: Type.STRING,
          description: 'Updated department name or ID (e.g., "Saree Dept", "Ladies Wear", "Accounts")',
        },
        designation: { type: Type.STRING, description: 'Updated designation' },
        phone: { type: Type.STRING, description: 'Updated mobile number' },
        saleId: { type: Type.STRING, description: 'Updated POS Sale ID' },
        status: { type: Type.STRING, description: 'ACTIVE or INACTIVE' },
        gender: { type: Type.STRING, description: 'Updated gender' },
        category: { type: Type.STRING, description: 'Updated staff category' },
        dateOfBirth: { type: Type.STRING, description: 'Updated DOB (YYYY-MM-DD)' },
        dateOfJoining: { type: Type.STRING, description: 'Updated DOJ (YYYY-MM-DD)' },
        panNumber: { type: Type.STRING, description: 'Updated PAN number' },
        uanNumber: { type: Type.STRING, description: 'Updated UAN number' },
        pfNumber: { type: Type.STRING, description: 'Updated PF number' },
        esicNumber: { type: Type.STRING, description: 'Updated ESIC number' },
        bankName: { type: Type.STRING, description: 'Updated Bank Name' },
        bankAccount: { type: Type.STRING, description: 'Updated Bank Account number' },
        bankIfsc: { type: Type.STRING, description: 'Updated Bank IFSC code' },
        address: { type: Type.STRING, description: 'Updated residential address' },
        emergencyContact: { type: Type.STRING, description: 'Updated emergency contact' },
        baseSalaryRupees: {
          type: Type.NUMBER,
          description: 'Updated Base Salary in rupees (updates customFields["Base Salary"] and if updateLatestSalarySlip is true + Main Owner, also updates latest unlocked salary slip basic)',
        },
        isBranchManager: { type: Type.BOOLEAN, description: 'Grant or revoke Branch Manager floor view flag' },
        reason: { type: Type.STRING, description: 'Optional audit reason for transfer or status change' },
      },
      required: ['employeeIdentifier'],
    },
  },
  {
    name: 'delete_employee',
    description:
      'Permanently delete an employee (Main Owner ONLY). MUST call with confirmed=false first to inspect target and ask user for verbal confirmation in Marathi, and ONLY pass confirmed=true after user says Yes/Ho.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        employeeIdentifier: { type: Type.STRING, description: 'Employee ID or name' },
        reason: { type: Type.STRING, description: 'Optional reason for audit log' },
        confirmed: {
          type: Type.BOOLEAN,
          description: 'Must be true ONLY after explicit user verbal confirmation ("हो" / "Yes")',
        },
      },
      required: ['employeeIdentifier'],
    },
  },
  {
    name: 'manage_incentive_adjustment',
    description:
      'Add, bulk-add, void, or permanently delete monthly incentive adjustments (BONUS, DEDUCTION, ADVANCE, RETURN_ADJUSTMENT) for a single employee, a whole department, or an entire branch.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'One of: ADD, BULK_ADD, VOID, DELETE',
        },
        monthKey: { type: Type.STRING, description: 'Month in YYYY-MM format (defaults to current month)' },
        employeeIdentifier: { type: Type.STRING, description: 'Target employee ID or name (for ADD/VOID/DELETE)' },
        branch: { type: Type.STRING, description: 'Target branch name/code (for BULK_ADD)' },
        department: { type: Type.STRING, description: 'Target department name/ID (for BULK_ADD)' },
        adjustmentType: {
          type: Type.STRING,
          description: 'BONUS, DEDUCTION, ADVANCE, or RETURN_ADJUSTMENT',
        },
        amountRupees: { type: Type.NUMBER, description: 'Amount in Indian Rupees (positive number)' },
        reason: { type: Type.STRING, description: 'Short explanation/reason for the bonus or deduction' },
        adjustmentId: { type: Type.STRING, description: 'Specific adjustment ID when voiding or deleting' },
        confirmed: {
          type: Type.BOOLEAN,
          description: 'Required true only for DELETE action after verbal confirmation',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_payout_status',
    description:
      'Mark incentive payout status as PAID, APPROVED, or UNPAID for a single employee or bulk for a branch/month, or permanently delete a payout record (Main Owner + confirmation).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'SET_STATUS, BULK_SET_STATUS, or DELETE' },
        monthKey: { type: Type.STRING, description: 'Target month YYYY-MM' },
        employeeIdentifier: { type: Type.STRING, description: 'Employee ID or name (for single payout)' },
        branch: { type: Type.STRING, description: 'Branch name/code (for bulk payout)' },
        department: {
          type: Type.STRING,
          description:
            'Optional department filter for BULK_SET_STATUS (e.g., SAREE, LADIES_WEAR, KIDS_WEAR, MENS_WEAR, NON_APPARELS, or ALL)',
        },
        status: { type: Type.STRING, description: 'PAID, APPROVED, or UNPAID' },
        paymentMode: { type: Type.STRING, description: 'BANK, CASH, or UPI' },
        paymentReference: { type: Type.STRING, description: 'UTR / Reference number or remark' },
        remarks: { type: Type.STRING, description: 'Optional payout remarks' },
        confirmed: { type: Type.BOOLEAN, description: 'Required true only for DELETE after confirmation' },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_salary_slip',
    description:
      'Edit an existing published salary slip (Basic, HRA, Sales Commission, Incentive, Overtime, Deductions, Paid Days, LOP, Payment Mode/Ref/Remarks — Main Owner), move salary slips to another month (Main Owner), or delete single/month salary slips (Main Owner + confirmation).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'EDIT, MOVE_MONTH, DELETE_SINGLE, or DELETE_MONTH' },
        monthKey: { type: Type.STRING, description: 'Source month in YYYY-MM format' },
        targetMonthKey: { type: Type.STRING, description: 'Destination month YYYY-MM (for MOVE_MONTH)' },
        employeeIdentifier: { type: Type.STRING, description: 'Employee ID or name (for EDIT or DELETE_SINGLE)' },
        branch: { type: Type.STRING, description: 'Optional branch filter when moving/deleting month slips' },
        basicRupees: { type: Type.NUMBER, description: 'Updated Basic salary in rupees' },
        hraRupees: { type: Type.NUMBER, description: 'Updated HRA in rupees' },
        conveyanceRupees: { type: Type.NUMBER, description: 'Updated Conveyance allowance in rupees' },
        incentiveRupees: { type: Type.NUMBER, description: 'Updated Incentive in rupees' },
        salesCommissionRupees: { type: Type.NUMBER, description: 'Updated Sales Commission in rupees' },
        overtimeRupees: { type: Type.NUMBER, description: 'Updated Overtime amount in rupees' },
        otherEarningsRupees: { type: Type.NUMBER, description: 'Updated Other Earnings in rupees' },
        pfRupees: { type: Type.NUMBER, description: 'Updated PF deduction in rupees' },
        esicRupees: { type: Type.NUMBER, description: 'Updated ESIC deduction in rupees' },
        ptRupees: { type: Type.NUMBER, description: 'Updated PT deduction in rupees' },
        advanceRecoveryRupees: { type: Type.NUMBER, description: 'Updated Advance recovery in rupees' },
        otherDeductionRupees: { type: Type.NUMBER, description: 'Updated Other deduction in rupees' },
        paidDays: { type: Type.NUMBER, description: 'Updated paid days' },
        lopDays: { type: Type.NUMBER, description: 'Updated LOP/absent days' },
        paymentMode: { type: Type.STRING, description: 'BANK, CASH, UPI, or CHEQUE' },
        paymentReference: { type: Type.STRING, description: 'Payment reference / UTR' },
        remarks: { type: Type.STRING, description: 'Salary slip remarks' },
        confirmed: {
          type: Type.BOOLEAN,
          description: 'Required true ONLY for DELETE_SINGLE or DELETE_MONTH after verbal confirmation',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_incentive_batches_and_months',
    description:
      'Approve, publish, reject, or delete staged/published incentive import batches, or purge an entire month of published incentives (Main Owner + verbal confirmation).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'LIST_PENDING, APPROVE_AND_PUBLISH, REJECT, DELETE_BATCH, or PURGE_MONTH',
        },
        batchId: { type: Type.STRING, description: 'Batch ID (optional; picks latest matching batch if omitted)' },
        monthKey: { type: Type.STRING, description: 'Month in YYYY-MM format (for PURGE_MONTH)' },
        reason: { type: Type.STRING, description: 'Reason for rejection, deletion, or purge' },
        confirmed: {
          type: Type.BOOLEAN,
          description: 'Required true ONLY for DELETE_BATCH (if published) or PURGE_MONTH after verbal confirmation',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'upload_excel_from_local_folder',
    description:
      'Find a spreadsheet (.xlsx or .csv) inside the user\'s linked local folder using fuzzy filename matching, parse & validate it using the app\'s real Incentive or Salary Slip import engine for the target month-year, save/publish it to Firestore, and refresh the UI live.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileQuery: {
          type: Type.STRING,
          description: 'File name or keywords spoken by user (e.g., "october incentive", "salary oct", "muktai_sheet")',
        },
        targetMonthKey: {
          type: Type.STRING,
          description: 'Target month in YYYY-MM format (e.g., "2026-10" for Oct-2026)',
        },
        uploadKind: {
          type: Type.STRING,
          description: 'AUTO (default auto-detect from headers/file), INCENTIVE (daily/monthly incentive .xlsx), or SALARY_SLIP (monthly paysheet .xlsx/.csv)',
        },
        businessDate: {
          type: Type.STRING,
          description: 'Optional exact business date YYYY-MM-DD for a single-day incentive workbook without a date banner',
        },
      },
      required: ['fileQuery', 'targetMonthKey'],
    },
  },
  {
    name: 'manage_branches_targets_loans',
    description:
      'Manage branches (add/edit/delete), monthly sales targets (branch or employee), employee loans (create/deduct EMI/close/delete), employee queries (resolve/delete), month visibility, or payroll month lock/unlock.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        domain: {
          type: Type.STRING,
          description: 'BRANCH, TARGET, LOAN, QUERY, VISIBILITY, or PAYROLL_LOCK',
        },
        action: {
          type: Type.STRING,
          description: 'ADD, UPDATE, DELETE, RESOLVE, DEDUCT_EMI, LOCK, UNLOCK, SHOW_MONTH, HIDE_MONTH',
        },
        monthKey: { type: Type.STRING, description: 'Target month YYYY-MM' },
        branch: { type: Type.STRING, description: 'Branch name or code' },
        city: { type: Type.STRING, description: 'Branch city (for BRANCH ADD/UPDATE)' },
        managerName: { type: Type.STRING, description: 'Branch manager name (for BRANCH ADD/UPDATE)' },
        employeeIdentifier: { type: Type.STRING, description: 'Employee ID or name (for TARGET, LOAN, QUERY)' },
        amountRupees: { type: Type.NUMBER, description: 'Target sale amount or loan principal in rupees' },
        targetQty: { type: Type.NUMBER, description: 'Target sale quantity (for TARGET)' },
        monthlyEmiRupees: { type: Type.NUMBER, description: 'Monthly EMI amount in rupees (for LOAN)' },
        replyOrReason: { type: Type.STRING, description: 'Admin reply (for QUERY) or note/remarks' },
        visibilityScope: { type: Type.STRING, description: 'INCENTIVES, SALARY_SLIPS, or BOTH (for VISIBILITY)' },
        confirmed: {
          type: Type.BOOLEAN,
          description: 'Required true ONLY for DELETE actions after verbal confirmation',
        },
      },
      required: ['domain', 'action'],
    },
  },
  {
    name: 'get_analytics_summary',
    description:
      'Compute live statistics from workspace data: totals, averages, top performers, branch/department breakdown, pending payouts, salary slip totals, active loans, or open queries.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        metric: {
          type: Type.STRING,
          description:
            'OVERVIEW, TOP_PERFORMERS, BRANCH_SUMMARY, DEPARTMENT_SUMMARY, PENDING_PAYOUTS, SALARY_SUMMARY, EMPLOYEE_SUMMARY, OPEN_QUERIES, ACTIVE_LOANS',
        },
        monthKey: { type: Type.STRING, description: 'Target month YYYY-MM (defaults to latest available month)' },
        branch: { type: Type.STRING, description: 'Optional branch filter' },
        department: { type: Type.STRING, description: 'Optional department filter' },
        employeeIdentifier: { type: Type.STRING, description: 'Optional employee ID or name for EMPLOYEE_SUMMARY' },
        limit: { type: Type.NUMBER, description: 'Max top items to return (default 5)' },
      },
      required: ['metric'],
    },
  },
  {
    name: 'download_report',
    description:
      'Generate and immediately trigger a browser download of any Excel, CSV, PDF, or ZIP report.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reportType: {
          type: Type.STRING,
          description:
            'MANAGEMENT_EXCEL, COMPLETE_BRANCH_PACK, BANK_NEFT_XLSX, BANK_NEFT_CSV, DCR_CASH_XLSX, DCR_CASH_CSV, STATUTORY_XLSX, STATUTORY_CSV, BRANCH_SALARY_REGISTER, BRANCH_INCENTIVE_REPORT, ATTENDANCE_OT_ATTRITION, EMPLOYEE_ROSTER, EMPLOYEE_SALARY_SLIP_PDF, EMPLOYEE_INCENTIVE_SLIP_PDF, BULK_SALARY_SLIPS_ZIP',
        },
        monthKey: { type: Type.STRING, description: 'Target month YYYY-MM (defaults to latest available)' },
        branch: { type: Type.STRING, description: 'Branch name/code or ALL' },
        employeeIdentifier: {
          type: Type.STRING,
          description: 'Employee ID or name (required for EMPLOYEE_SALARY_SLIP_PDF or EMPLOYEE_INCENTIVE_SLIP_PDF)',
        },
      },
      required: ['reportType'],
    },
  },
  {
    name: 'prepare_whatsapp_dispatch',
    description:
      'Prepare instant 1-tap WhatsApp dispatch links (with pre-filled polite Marathi Salary Slip or Incentive Summary message) for a specific employee OR for all staff in a branch/department for a given month. Call this tool DIRECTLY with employee name (e.g. "Shobha Londhe") or ID — do NOT call search_employees beforehand. Displays a ready-to-send WhatsApp card in the Voice Assistant panel.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        employeeIdentifier: {
          type: Type.STRING,
          description: 'Employee ID or English/Latin name (for single employee WhatsApp dispatch)',
        },
        branch: {
          type: Type.STRING,
          description: 'Branch name/code (for branch-wide WhatsApp dispatch when employeeIdentifier is not given)',
        },
        department: {
          type: Type.STRING,
          description: 'Optional department filter for branch-wide WhatsApp dispatch (e.g., SAREE, LADIES_WEAR)',
        },
        monthKey: {
          type: Type.STRING,
          description: 'Target month YYYY-MM (defaults to latest available month for that employee/branch)',
        },
        documentType: {
          type: Type.STRING,
          description: 'AUTO (default — prefers Salary Slip if available, else Incentive Summary), SALARY_SLIP, or INCENTIVE_SUMMARY',
        },
      },
    },
  },
  {
    name: 'get_executive_briefing',
    description:
      'Generate a comprehensive House of Muktai Executive Morning/Management Business Briefing for the target month (or latest active month) including Total Sales, Gross Incentives, Net Salary Payroll, Cost-to-Sales %, Top 3 Branches, Pending Payouts, Star Performers, Consecutive Sales Drop Alerts, Open Queries, Active Loans, and High-LOP Attendance Flags, and show a visual briefing card.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        monthKey: {
          type: Type.STRING,
          description: 'Target month YYYY-MM (defaults to latest available month with sales/payroll data)',
        },
        branch: {
          type: Type.STRING,
          description: 'Optional branch filter (or ALL for full 12-branch company briefing)',
        },
      },
    },
  },
];
