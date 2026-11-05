import type { NodeType } from '@synapse/core';

/** Demo content for a fresh vault. Offsets are days relative to seeding time. */
export interface SampleNode {
  type: Exclude<NodeType, 'journal' | 'inbox'> | 'journal' | 'inbox';
  title: string;
  summary: string;
  status?: string;
  tags?: string[];
  aliases?: string[];
  links?: string[];
  area?: string;
  project?: string;
  /** area: the map it belongs to (VAULT-SPEC "Maps"); absent = the mind map. */
  map?: string;
  /** map: the maps it connects to — map titles, or `mind`. */
  connects?: string[];
  people?: string[];
  dueOffset?: number;
  scheduledOffset?: number;
  priority?: number;
  /** journal: date offset from today */
  dateOffset?: number;
  relation?: string;
  url?: string;
  /** goal: target date offset from today */
  targetOffset?: number;
  /** habit: check-in dates as offsets from today (0 = today, -1 = yesterday) */
  checkinOffsets?: number[];
  /** event: date offset from today */
  eventDateOffset?: number;
  /** Other kind fields written as-is (VAULT-SPEC "Kinds"). */
  extra?: Record<string, string | number>;
  source?: 'capture' | 'brain' | 'manual' | 'import';
  body: string;
  createdDaysAgo: number;
  updatedDaysAgo?: number;
}

export const sampleNodes: SampleNode[] = [
  // ---- goals, habits, moments and links (VAULT-SPEC "Kinds")
  { type: 'goal', title: 'دویدن ۱۰ کیلومتر تا بهار', summary: 'آماده شدن برای دویدن پیوسته‌ی ۱۰ کیلومتر تا اول بهار.', area: 'سلامتی', links: ['برنامه‌ی تناسب اندام'], targetOffset: 140, extra: { progress: 35, why: 'قلب سالم‌تر و انرژی بیشتر برای کار.' }, tags: ['running'], body: 'قدم‌ها: ۵ کیلومتر پیوسته (انجام شد) → ۷ کیلومتر → ۱۰ کیلومتر. هر ماه یک دویدن آزمایشی.\n', createdDaysAgo: 30, updatedDaysAgo: 3 },
  { type: 'goal', title: 'پس‌انداز ۲۰٪ درآمد', summary: 'هر ماه دست‌کم یک‌پنجم درآمد کنار گذاشته شود.', area: 'مالی', targetOffset: 60, extra: { progress: 60, why: 'یک پشتوانه‌ی شش‌ماهه برای آرامش خاطر.' }, body: 'سه ماه از پنج ماه هدف رسیده.\n', createdDaysAgo: 55, updatedDaysAgo: 8 },
  { type: 'habit', title: 'مدیتیشن صبحگاهی', summary: 'ده دقیقه مدیتیشن بعد از بیدار شدن.', area: 'سلامتی', checkinOffsets: [-1, -2, -4, -5, -6, -7], extra: { cadence: 'daily', time: 'morning' }, body: 'با اپ تایمر، روی تنفس تمرکز می‌کنم.\n', createdDaysAgo: 25, updatedDaysAgo: 1 },
  { type: 'habit', title: 'خواندن ۲۰ صفحه کتاب', summary: 'هر شب پیش از خواب بیست صفحه.', area: 'یادگیری', checkinOffsets: [0, -1, -2], extra: { cadence: 'daily', time: 'night' }, links: ['The Rust Programming Language'], body: 'کتاب فعلی: [[The Rust Programming Language]].\n', createdDaysAgo: 12, updatedDaysAgo: 0 },
  { type: 'event', title: 'شام تولد مامان', summary: 'دورهمی خانوادگی برای تولد مامان؛ خیلی خوش گذشت.', area: 'خانواده', people: ['مامان'], eventDateOffset: -9, extra: { mood: 'great', place: 'خانه‌ی مامان' }, body: 'همه بودند. مامان از هدیه خوشش آمد و قرار شد [[سفر نوروز ۱۴۰۶]] را با هم برنامه‌ریزی کنیم.\n', createdDaysAgo: 9, updatedDaysAgo: 9 },
  { type: 'event', title: 'گفتگوی سخت با علی درباره‌ی ددلاین', summary: 'سر عقب افتادن سایت دلخوری پیش آمد؛ آخرش با یک برنامه‌ی تازه آشتی کردیم.', area: 'کار', people: ['علی'], links: ['وب‌سایت شخصی'], eventDateOffset: -3, extra: { mood: 'low', place: 'کافه' }, body: 'حس کردم فشار زیادی رویش گذاشتم. توافق کردیم هر هفته یک جلسه‌ی کوتاه داشته باشیم.\n', createdDaysAgo: 3, updatedDaysAgo: 3 },
  { type: 'resource', title: 'Thinking in React', summary: 'آموزش رسمی React درباره‌ی شکستن رابط کاربری به کامپوننت‌ها؛ برای بعد.', area: 'یادگیری', url: 'https://react.dev/learn/thinking-in-react', extra: { kind: 'article' }, body: '- رابط را به سلسله‌مراتب کامپوننت‌ها بشکن\n- اول نسخه‌ی استاتیک را بساز\n- حداقل state را پیدا کن\n', createdDaysAgo: 5, updatedDaysAgo: 5 },
  { type: 'resource', title: 'Learn Rust', summary: 'صفحه‌ی آموزش رسمی Rust: کتاب، تمرین‌ها و Rust by Example.', area: 'یادگیری', status: 'doing', url: 'https://www.rust-lang.org/learn', extra: { kind: 'course' }, body: 'از Rust by Example برای تمرین استفاده می‌کنم.\n', createdDaysAgo: 18, updatedDaysAgo: 6 },

  // ---- areas
  { type: 'area', title: 'سلامتی', summary: 'تن و روان: ورزش، خواب، تغذیه و چکاپ‌های دوره‌ای.', tags: ['health'], body: 'معیار خوب بودن: سه جلسه ورزش در هفته، خواب قبل از ۲۳:۳۰، چکاپ سالانه.\n', createdDaysAgo: 60 },
  { type: 'area', title: 'کار', summary: 'شغل و پروژه‌های حرفه‌ای؛ ساخت محصول و درآمد.', tags: ['work'], body: 'تمرکز امسال: ساخت [[Synapse app]] و راه‌اندازی [[وب‌سایت شخصی]].\n', createdDaysAgo: 60 },
  { type: 'area', title: 'خانواده', summary: 'روابط نزدیک، برنامه‌های مشترک و سفرها.', tags: ['family'], body: 'تماس هفتگی با [[مامان]]؛ یک سفر خانوادگی در سال.\n', createdDaysAgo: 60 },
  { type: 'area', title: 'یادگیری', summary: 'مهارت‌های جدید، کتاب‌ها و دوره‌ها.', tags: ['learning'], body: 'یک کتاب فنی در ماه؛ یادداشت‌ها در همین vault.\n', createdDaysAgo: 60 },
  { type: 'area', title: 'مالی', summary: 'بودجه، پس‌انداز و سرمایه‌گذاری.', tags: ['finance'], body: 'بازبینی ماهانه‌ی هزینه‌ها، هدف پس‌انداز ۲۰٪.\n', createdDaysAgo: 58 },

  // ---- maps (VAULT-SPEC "Maps"): the character map the brain keeps about the owner, and a custom map for a page
  { type: 'map', title: 'کاراکتر من', summary: 'چه‌جور آدمی هستم: ویژگی‌ها، چیزهایی که برایم مهم است، دغدغه‌ها و لحنم — ساخته‌ی مغز از روی همین vault.', connects: ['mind'], extra: { role: 'character' }, body: 'مغز این نقشه را از روی یادداشت‌ها، هدف‌ها، عادت‌ها و روزنوشت‌ها می‌سازد و با /character به‌روز می‌کند.\n', createdDaysAgo: 7, updatedDaysAgo: 2 },
  { type: 'map', title: 'پیج عکاسی', summary: 'پیج اینستاگرام عکاسی خیابانی‌ام: لحن، مخاطب و ایده‌های محتوا.', connects: ['mind', 'کاراکتر من'], body: 'هدف: هفته‌ای دو پست، لحن صمیمی و کوتاه، عکس‌های سیاه‌وسفید تهران.\n', createdDaysAgo: 5, updatedDaysAgo: 1 },
  { type: 'area', title: 'ویژگی‌ها', summary: 'ویژگی‌های شخصیتی، آن‌طور که از کارها و یادداشت‌ها پیداست.', map: 'کاراکتر من', body: '', createdDaysAgo: 7 },
  { type: 'area', title: 'ارزش‌ها', summary: 'چیزهایی که برایم مهم است و برایشان وقت می‌گذارم.', map: 'کاراکتر من', body: '', createdDaysAgo: 7 },
  { type: 'area', title: 'دغدغه‌ها', summary: 'چیزهایی که این روزها ذهنم را مشغول می‌کند.', map: 'کاراکتر من', body: '', createdDaysAgo: 7 },
  { type: 'area', title: 'لحن', summary: 'چطور می‌نویسم و حرف می‌زنم.', map: 'کاراکتر من', body: '', createdDaysAgo: 7 },
  { type: 'area', title: 'لحن پیج', summary: 'صدای پیج: چه‌جور می‌نویسیم و چه‌جور نه.', map: 'پیج عکاسی', body: '', createdDaysAgo: 5 },
  { type: 'area', title: 'ایده‌های محتوا', summary: 'ایده‌های پست و استوری برای پیج.', map: 'پیج عکاسی', body: '', createdDaysAgo: 5 },
  { type: 'note', title: 'سازنده‌ام، نه جمع‌کننده', summary: 'وقتی چیزی می‌خوانم می‌خواهم ازش چیزی بسازم؛ Synapse و مینی‌دوره‌ی Rust از همین‌جا می‌آیند.', area: 'ویژگی‌ها', body: 'شاهد: [[Synapse app]] بعد از یادداشت [[Obsidian: why it didn\'t stick]]؛ [[مینی‌دوره‌ی Rust برای دوستان]] وسط خواندن کتاب.\n', createdDaysAgo: 7, updatedDaysAgo: 2 },
  { type: 'note', title: 'سلامتی قبل از همه', summary: 'ورزش و خواب را جدی می‌گیرم، حتی وقتی کار فشار می‌آورد.', area: 'ارزش‌ها', body: 'شاهد: [[دویدن ۱۰ کیلومتر تا بهار]]، [[مدیتیشن صبحگاهی]] با شش روز پشت سر هم، [[Sleep routine]].\n', createdDaysAgo: 7, updatedDaysAgo: 2 },
  { type: 'note', title: 'ترس از عقب افتادن پروژه‌ها', summary: 'ددلاین‌ها که می‌لغزند، رابطه‌ها هم تلخ می‌شوند؛ سایت با علی نمونه‌اش.', area: 'دغدغه‌ها', body: 'شاهد: [[گفتگوی سخت با علی درباره‌ی ددلاین]]، [[Review monthly expenses]] پنج روز عقب.\n', createdDaysAgo: 7, updatedDaysAgo: 2 },
  { type: 'note', title: 'کوتاه و مستقیم، با یک چاشنی شوخی', summary: 'جمله‌های کوتاه، فعل‌های محاوره‌ای، بدون تعارف؛ گاهی یک شوخی وسطش.', area: 'لحن', body: 'نمونه از روزنوشت‌ها: «کل روز روی گراف بودم. ورزش امروز تعطیل.» — از «می‌باشد» و جمله‌های بلند خبری نیست.\n', createdDaysAgo: 7, updatedDaysAgo: 2 },
  { type: 'note', title: 'صمیمی، اول‌شخص، بدون هشتگ‌بازی', summary: 'پست‌ها مثل حرف زدن با یک دوست: یک عکس، دو سه جمله، یک سؤال آخرش.', area: 'لحن پیج', body: 'نه: «عکاسی هنر دیدن است…» · آره: «این کوچه رو صد بار رد شده بودم و ندیده بودمش.»\nحداکثر سه هشتگ، آخر کپشن.\n', createdDaysAgo: 5, updatedDaysAgo: 1 },
  { type: 'idea', title: 'سری «کوچه‌های تهران»', summary: 'هفته‌ای یک کوچه، سیاه‌وسفید، با یک جمله درباره‌ی آدم‌هایش.', area: 'ایده‌های محتوا', body: 'شروع از پارک ملت که مسیر [[دویدن سه‌شنبه]] است.\n', createdDaysAgo: 4 },

  // ---- projects
  { type: 'project', title: 'Synapse app', summary: 'Build the AI-native second brain: vault, graph UI, brain engine.', area: 'کار', tags: ['synapse', 'product'], body: '**Outcome:** a daily-used app where capture → graph → review works end to end.\n\n**Next action:** [[Build graph view prototype]]\n\nSee [[Obsidian: why it didn\'t stick]] for the problem statement and [[react-force-graph]] for the rendering library.\n', createdDaysAgo: 10, updatedDaysAgo: 0 },
  { type: 'project', title: 'وب‌سایت شخصی', summary: 'راه‌اندازی سایت شخصی با نمونه‌کارها و بلاگ.', area: 'کار', people: ['علی'], tags: ['web'], body: '**نتیجه:** سایت با سه بخش: درباره، نمونه‌کار، بلاگ.\n\n**قدم بعد:** [[مرور پروژه‌ی سایت با علی]]\n', createdDaysAgo: 40, updatedDaysAgo: 4 },
  { type: 'project', title: 'برنامه‌ی تناسب اندام', summary: 'سه جلسه ورزش در هفته و رسیدن به دویدن ۵ کیلومتر.', area: 'سلامتی', tags: ['health', 'running'], body: '**نتیجه:** دویدن پیوسته‌ی ۵ کیلومتر تا پایان پاییز.\n\n**قدم بعد:** [[دویدن سه‌شنبه]]\n\nمرتبط: [[Sleep routine]]\n', createdDaysAgo: 45, updatedDaysAgo: 2 },
  { type: 'project', title: 'یادگیری Rust', summary: 'خواندن کتاب Rust و ساخت یک ابزار CLI کوچک.', status: 'paused', area: 'یادگیری', tags: ['rust', 'learning'], body: '**نتیجه:** یک CLI کوچک برای مدیریت یادداشت‌های متنی.\n\n**قدم بعد:** [[Read Rust book chapters 4-6]]\n\nمنبع اصلی: [[The Rust Programming Language]]\n', createdDaysAgo: 30, updatedDaysAgo: 20 },
  { type: 'project', title: 'سفر نوروز ۱۴۰۶', summary: 'برنامه‌ریزی سفر خانوادگی نوروز: مقصد، بودجه، رزرو.', area: 'خانواده', people: ['مامان'], tags: ['travel'], body: '**نتیجه:** سفر ۵ روزه به مشهد با همه‌ی خانواده، بودجه‌ی مشخص.\n\n**قدم بعد:** [[رزرو هتل مشهد]]\n', createdDaysAgo: 20, updatedDaysAgo: 10 },
  { type: 'project', title: 'بودجه‌ی سالانه', summary: 'بازبینی هزینه‌ها و تنظیم بودجه‌ی ماهانه.', status: 'done', area: 'مالی', tags: ['finance'], body: '**نتیجه:** بودجه‌ی ماهانه در یک جدول؛ انجام شد.\n', createdDaysAgo: 50, updatedDaysAgo: 15 },

  // ---- people
  { type: 'person', title: 'علی', summary: 'دوست و همکار؛ طراح فرانت‌اند، همراه در پروژه‌ی سایت.', aliases: ['Ali'], relation: 'friend', body: 'با هم روی [[وب‌سایت شخصی]] کار می‌کنیم. جلسات معمولاً عصر سه‌شنبه‌ها.\n', createdDaysAgo: 50, updatedDaysAgo: 4 },
  { type: 'person', title: 'سارا احمدی', summary: 'مدیر محصول در تیم قبلی؛ منبع خوب برای بازخورد محصول.', relation: 'colleague', body: 'بازخوردش روی ایده‌ی [[Synapse app]] در [[یادداشت جلسه با سارا]].\n', createdDaysAgo: 40, updatedDaysAgo: 12 },
  { type: 'person', title: 'دکتر رضایی', summary: 'پزشک خانواده؛ مطب شهرک غرب، نوبت از ساعت ۹.', relation: 'doctor', body: 'چکاپ سالانه هر پاییز.\n', createdDaysAgo: 55, updatedDaysAgo: 6 },
  { type: 'person', title: 'مامان', summary: 'تماس هفتگی یکشنبه‌ها؛ مسئول هماهنگی سفر نوروز.', relation: 'family', body: 'درباره‌ی [[سفر نوروز ۱۴۰۶]] با او هماهنگ می‌کنم.\n', createdDaysAgo: 59, updatedDaysAgo: 1 },
  { type: 'person', title: 'Reza Karimi', summary: 'Former manager; monthly call about career and product strategy.', aliases: ['رضا کریمی'], relation: 'mentor', body: 'Monthly mentoring call. Bring the [[Synapse app]] roadmap.\n', createdDaysAgo: 35, updatedDaysAgo: 9 },
  { type: 'person', title: 'Dr. Chen', summary: 'Researcher met at the knowledge-graph meetup; interested in Synapse.', relation: 'colleague', body: 'Met at the meetup — see [[Knowledge-graph meetup notes]].\n', createdDaysAgo: 8, updatedDaysAgo: 1 },

  // ---- tasks
  { type: 'task', title: 'تماس با دکتر رضایی', summary: 'نوبت معاینه‌ی سالانه بگیرم؛ ترجیحاً صبح.', status: 'todo', dueOffset: -2, priority: 2, area: 'سلامتی', people: ['دکتر رضایی'], tags: ['health'], source: 'capture', body: 'شماره‌ی مطب در [[دکتر رضایی]]. بعد از تماس نتیجه را در ژورنال بنویس.\n', createdDaysAgo: 6, updatedDaysAgo: 3 },
  { type: 'task', title: 'مرور پروژه‌ی سایت با علی', summary: 'جلسه‌ی مرور طرح صفحه‌ی اصلی و فهرست نمونه‌کارها.', status: 'todo', dueOffset: 0, project: 'وب‌سایت شخصی', people: ['علی'], source: 'capture', body: '- [ ] طرح صفحه‌ی اصلی\n- [ ] فهرست نمونه‌کارها\n- [ ] زمان‌بندی بلاگ\n', createdDaysAgo: 4 },
  { type: 'task', title: 'Write the vault spec', summary: 'Finalize VAULT-SPEC v0.1: frontmatter, index tiers, edges.', status: 'done', project: 'Synapse app', tags: ['synapse'], body: 'Done — see docs/VAULT-SPEC.md in the repo.\n', createdDaysAgo: 5, updatedDaysAgo: 1 },
  { type: 'task', title: 'Build graph view prototype', summary: '2D force graph with type colors, hover highlight and local focus.', status: 'doing', dueOffset: 3, priority: 1, project: 'Synapse app', tags: ['synapse', 'graph'], body: 'Library: [[react-force-graph]]. Idea to fold in: [[گراف زمان‌دار مغز]].\n', createdDaysAgo: 3, updatedDaysAgo: 0 },
  { type: 'task', title: 'دویدن سه‌شنبه', summary: 'دویدن ۳ کیلومتر در پارک، ساعت ۷ صبح.', status: 'todo', scheduledOffset: 2, project: 'برنامه‌ی تناسب اندام', tags: ['running'], body: 'مسیر: پارک ملت، دور کامل.\n', createdDaysAgo: 2 },
  { type: 'task', title: 'خرید کفش دویدن', summary: 'کفش مناسب دویدن بخرم؛ بودجه تا ۳ میلیون.', status: 'done', project: 'برنامه‌ی تناسب اندام', body: 'خریده شد.\n', createdDaysAgo: 20, updatedDaysAgo: 12 },
  { type: 'task', title: 'رزرو هتل مشهد', summary: 'دو اتاق برای ۳ تا ۷ فروردین؛ نزدیک حرم.', status: 'todo', dueOffset: 14, project: 'سفر نوروز ۱۴۰۶', people: ['مامان'], body: 'گزینه‌ها را با [[مامان]] چک کن.\n', createdDaysAgo: 10 },
  { type: 'task', title: 'تماس هفتگی با مامان', summary: 'یکشنبه عصر زنگ بزنم؛ درباره‌ی سفر و حال بابا.', status: 'todo', scheduledOffset: 1, area: 'خانواده', people: ['مامان'], body: '', createdDaysAgo: 1 },
  { type: 'task', title: 'Read Rust book chapters 4-6', summary: 'Ownership, structs, enums — take notes in the Rust note.', status: 'todo', project: 'یادگیری Rust', tags: ['rust'], body: 'Source: [[The Rust Programming Language]].\n', createdDaysAgo: 25, updatedDaysAgo: 20 },
  { type: 'task', title: 'Review monthly expenses', summary: 'Categorize last month\'s expenses and compare with the budget.', status: 'todo', dueOffset: -5, priority: 3, area: 'مالی', tags: ['finance'], body: 'Template from [[بودجه‌ی سالانه]].\n', createdDaysAgo: 12 },
  { type: 'task', title: 'Send Synapse demo to Dr. Chen', summary: 'Record a 2-minute graph demo and email it.', status: 'todo', dueOffset: 5, project: 'Synapse app', people: ['Dr. Chen'], body: 'Show the time-lapse and local focus.\n', createdDaysAgo: 1 },
  { type: 'task', title: 'نوشتن پست وبلاگ درباره‌ی مغز دوم', summary: 'پست اول بلاگ: چرا ابزارهای فعلی را رها کردم.', status: 'todo', project: 'وب‌سایت شخصی', tags: ['writing'], body: 'نکته‌ها از [[Obsidian: why it didn\'t stick]].\n', createdDaysAgo: 7 },
  { type: 'task', title: 'Call Reza about product strategy', summary: 'Monthly mentoring call; bring the Synapse roadmap.', status: 'doing', scheduledOffset: 1, area: 'کار', people: ['Reza Karimi'], body: 'Questions: pricing, positioning vs Obsidian, mobile timing.\n', createdDaysAgo: 9, updatedDaysAgo: 0 },

  // ---- ideas
  { type: 'idea', title: 'گراف زمان‌دار مغز', summary: 'دیدن رشد مغز به صورت تایم‌لپس بر اساس تاریخ ساخت گره‌ها.', project: 'Synapse app', tags: ['synapse', 'graph'], body: 'هر گره با `created` خودش ظاهر شود؛ مثل حالت Animate در آبسیدین ولی با رنگ نوع.\n\n**چرا مهم است:** حس پیشرفت و الگوهای فکری را نشان می‌دهد.\n**قدم بعد:** اسلایدر بازه‌ی زمانی در کنترل‌های گراف.\n', createdDaysAgo: 4 },
  { type: 'idea', title: 'Voice capture on the phone', summary: 'Dictate thoughts on the go; the brain files them later.', project: 'Synapse app', tags: ['synapse', 'mobile'], body: 'PWA first, recording → inbox item → /capture on the desktop.\n', createdDaysAgo: 6 },
  { type: 'idea', title: 'کلاس یوگای صبحگاهی', summary: 'ثبت‌نام در کلاس یوگا برای کاهش استرس و بهبود خواب.', area: 'سلامتی', body: 'شاید جایگزین یکی از جلسات دویدن. مرتبط: [[Sleep routine]].\n', createdDaysAgo: 15 },
  { type: 'idea', title: 'Weekly review ritual', summary: 'Every Friday: inbox zero, project next actions, journal highlights.', area: 'کار', links: ['PARA و GTD'], tags: ['productivity'], body: 'Could become a `/weekly` skill of the brain.\n', createdDaysAgo: 9 },
  { type: 'idea', title: 'مینی‌دوره‌ی Rust برای دوستان', summary: 'تجربه‌ی یادگیری Rust را به یک دوره‌ی کوچک آنلاین تبدیل کنم.', project: 'یادگیری Rust', body: 'بعد از تمام شدن کتاب.\n', createdDaysAgo: 18 },

  // ---- notes
  { type: 'note', title: 'PARA و GTD', summary: 'خلاصه‌ی روش PARA (پروژه، حوزه، منبع، آرشیو) و پیوندش با GTD.', area: 'یادگیری', tags: ['productivity'], body: 'PARA می‌گوید هر چیز کجا باشد؛ GTD می‌گوید بعدش چه کنیم. حوزه‌های من: [[سلامتی]]، [[کار]]، [[خانواده]]، [[یادگیری]]، [[مالی]].\n\nمنبع: [[Building a Second Brain (book)]]\n', createdDaysAgo: 30 },
  { type: 'note', title: 'Knowledge-graph meetup notes', summary: 'Takeaways: index-first retrieval, typed edges, local-first sync.', area: 'یادگیری', people: ['Dr. Chen'], tags: ['synapse', 'research'], body: '- Index-first retrieval beats embedding-everything for personal vaults.\n- Typed edges (belongs_to, mentions) make graphs readable.\n- Follow up: [[Send Synapse demo to Dr. Chen]]\n', createdDaysAgo: 8 },
  { type: 'note', title: 'یادداشت جلسه با سارا', summary: 'بازخورد سارا روی ایده‌ی Synapse: تمرکز روی ثبت بی‌دردسر.', project: 'Synapse app', people: ['سارا احمدی'], body: '- ثبت باید در دو ثانیه انجام شود.\n- گراف جذاب است ولی باید کاربردی هم باشد (فوکوس محلی).\n', createdDaysAgo: 12 },
  { type: 'note', title: 'Sleep routine', summary: 'Lights off 23:30, no screens after 23:00; track with the fitness plan.', area: 'سلامتی', project: 'برنامه‌ی تناسب اندام', tags: ['health', 'sleep'], body: 'Caffeine cutoff 15:00.\n', createdDaysAgo: 22 },
  { type: 'note', title: 'Obsidian: why it didn\'t stick', summary: 'Manual Markdown, folders vs tags, flexibility as friction; what Synapse must do instead.', project: 'Synapse app', tags: ['synapse', 'research'], body: 'What to keep: local files, links, graph. What to change: the AI does the filing; typed nodes; fixed life views.\n', createdDaysAgo: 11 },
  { type: 'note', title: 'تنظیمات سرور خانگی', summary: 'پورت‌ها، آدرس IP ثابت و بکاپ هفتگی NAS.', area: 'کار', tags: ['homelab'], body: 'بکاپ هفتگی جمعه‌ها ساعت ۳ صبح.\n', createdDaysAgo: 33 },

  // ---- resources
  { type: 'resource', title: 'Building a Second Brain (book)', summary: 'Tiago Forte\'s book; source of PARA and the CODE method.', url: 'https://www.buildingasecondbrain.com/', area: 'یادگیری', links: ['PARA و GTD'], body: 'Read in spring; notes in [[PARA و GTD]].\n', createdDaysAgo: 29 },
  { type: 'resource', title: 'The Rust Programming Language', summary: 'The official Rust book, free online.', url: 'https://doc.rust-lang.org/book/', project: 'یادگیری Rust', tags: ['rust'], body: '', createdDaysAgo: 30 },
  { type: 'resource', title: 'react-force-graph', summary: 'Library used for the Synapse graph view (2D/3D).', url: 'https://github.com/vasturiano/react-force-graph', project: 'Synapse app', tags: ['synapse', 'graph'], body: 'MIT. 2D canvas + 3D WebGL with one API.\n', createdDaysAgo: 3 },

  // ---- journal
  { type: 'journal', title: '', summary: 'روز شلوغ کاری؛ طرح گراف جلو رفت، ورزش نکردم.', dateOffset: -2, body: '## 21:40\nکل روز روی [[Build graph view prototype]] بودم. [[برنامه‌ی تناسب اندام]] امروز تعطیل.\n', createdDaysAgo: 2 },
  { type: 'journal', title: '', summary: 'تماس با رضا عقب افتاد؛ شب کتاب Rust خواندم.', dateOffset: -1, body: '## 22:10\n[[Call Reza about product strategy]] به فردا موکول شد. یک فصل از [[The Rust Programming Language]] خواندم.\n', createdDaysAgo: 1 },
  { type: 'journal', title: '', summary: 'صبح دویدم؛ امروز جلسه با علی درباره‌ی سایت.', dateOffset: 0, body: '## 08:15\nدویدن سبک. بعدازظهر [[مرور پروژه‌ی سایت با علی]].\n', createdDaysAgo: 0 },

  // ---- inbox
  { type: 'inbox', title: 'ایده: یادآوری خودکار برای تولد دوست‌ها', summary: 'ایده: یادآوری خودکار برای تولد دوست‌ها', source: 'capture', body: 'ایده: یادآوری خودکار برای تولد دوست‌ها از روی گره‌های افراد، یک هفته قبل.\n', createdDaysAgo: 0 },
  { type: 'inbox', title: 'Check Tauri 2 mobile sidecar limits', summary: 'Check Tauri 2 mobile sidecar limits before planning the phone app', source: 'capture', body: 'Check Tauri 2 mobile sidecar limits before planning the phone app — maybe the phone only talks to the desktop brain.\n', createdDaysAgo: 0 },
];
