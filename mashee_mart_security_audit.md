# تقرير التدقيق الأمني المتخصص — ماشي مارت (DDD Mart)

**نوع الفحص:** فحص أمني عميق ومتخصص (Deep-Dive Security Audit) يركّز حصراً على **الأمان المالي، حماية البيانات، وتصعيد الصلاحيات** — لا يغطي هذا التقرير أخطاء برمجية عامة أو ملاحظات واجهة مستخدم.

**المنهجية:** فريق "ريد تيم" مكوّن من 4 عملاء بحث مستقلين عملوا بالتوازي، كل واحد بمحور مخصص (قاعدة البيانات/RLS، الهويات والصلاحيات، الواجهة والبيانات المحلية، النزاهة المالية)، وقرأ كل عميل الكود الفعلي (migrations، services، hooks، RLS policies، API routes) سطراً بسطر. حيثما توصّل أكثر من عميل لنفس الثغرة من زاويتين مختلفتين، تم ذكر ذلك صراحة كـ"تأكيد مستقل" — وهذا يرفع درجة الثقة بالثغرة.

**لا يوجد أي تعديل على الكود في هذا الفحص** — تقرير قراءة فقط (Read-only). كل بند يحتاج قرار وتنفيذ منفصل عبر نفس منهجية الإصلاح المتبعة سابقاً (Plan agent → Execute agent → تحقق مستقل → تأكيد صريح قبل التطبيق على القاعدة الحية والرفع).

**السياق:** هذا الفحص يأتي بعد تدقيق أمني شامل سابق (`mashee_mart_audit_report.md`, 2026-09-06) تم فيه إصلاح 8 ثغرات حرجة وتطبيقها على القاعدة الحية (2026-09-07)، بالإضافة لبنود متوسطة أخرى أُصلحت لاحقاً (ترقيم صفحات الأرشيف، منع القيم السالبة للأسعار، فرض وردية مفتوحة). تم التحقق صراحة من أن كل تلك الإصلاحات ما زالت سارية — والنتيجة أنها **جميعاً سليمة** (تفاصيل التحقق ضمن قسم "مراقب النزاهة المالية" و"مفتش قواعد البيانات" أدناه). هذا الفحص يكتشف ثغرات **جديدة** لم يغطّها التدقيق السابق، معظمها في تطبيقات لصفحة الموظفين ووحدات المنتجات (`product_units`) والمخزون والورديات التي أُضيفت أو لم تُشمل بحملة التحصين السابقة.

---

## ملخص تنفيذي

| المستوى | العدد |
|---|---|
| 🔴 حرج | 4 |
| 🟠 مرتفع | 4 |
| 🟡 متوسط | 5 |
| 🟢 منخفض / تحسين | 2 |
| ✅ تم التحقق (لا توجد مشكلة) | ~25 بنداً موزّعة على الأقسام |

**أخطر 3 نقاط يُنصح بالبدء فيها فوراً:**

1. **أي كاشير يقدر يرفّع نفسه إلى أدمن بنفسه** — اكتُشفت بشكل **مستقل من عميلين مختلفين** (مفتش قواعد البيانات + مدقق الهويات). سياسة صلاحيات جدول `profiles` تسمح لأي مستخدم بتعديل صف حسابه الخاص بأي عمود يريده — بما فيه عمود `role` — طالما يبقى ضمن نفس المتجر. أي كاشير يملك جلسة دخول صالحة يقدر يستدعي واجهة Supabase مباشرة (بدون المرور بواجهة التطبيق إطلاقاً) ويجعل نفسه أدمن بشكل دائم.
2. **السعر المُدخل في نقطة البيع غير مُعاد التحقق منه من الخادم** — اكتُشفت بشكل **مستقل من عميلين مختلفين** (محلل الواجهة والبيانات المحلية + مراقب النزاهة المالية). عملية الدفع (سواء أونلاين أو عبر المزامنة اللاحقة للوضع دون اتصال) تخزّن السعر كما يرسله المتصفح دون إعادة جلبه من جدول `products` الحقيقي — يفتح الباب لكاشير خبيث لتسجيل مبيعات بسعر مُلفَّق (سرقة داخلية / اختلاس بدون أثر واضح).
3. **جدول `product_units` (وحدات البيع كالكرتون/الكيس) لم يُشمل بحملة فصل صلاحيات الأدمن عن الكاشير** التي طُبّقت سابقاً على `products`/`categories` — أي كاشير يقدر يعدّل أسعار وحدات البيع أو يحذفها مباشرة عبر القاعدة.

---

## 1️⃣ مفتش قواعد البيانات (DB & RLS Inspector)

**النطاق:** كل ملفات `supabase/migrations/*.sql` بترتيبها الزمني (تم حل كل سياسة لآخر نسخة معتمدة منها فعلياً، وليس تعريفها الأول)، مقارنة مع نقاط استدعائها الفعلية في الكود.

### 🔴 حرج — الكاشير يقدر يرفّع نفسه إلى أدمن (تأكيد مستقل، انظر أيضاً بند مدقق الهويات #1)
- **الملف/السطر:** `supabase/migrations/00000000000012_multi_tenancy_foundation.sql:187-190` (سياسة `"self update profile"`)
- **الوصف:** السياسة الحالية:
  ```sql
  create policy "self update profile" on profiles for update to authenticated
    using (auth.uid() = id)
    with check (auth.uid() = id and store_id = current_store_id());
  ```
  تمنع تغيير `store_id` (قفز بين المتاجر) لكنها **لا تقيّد عمود `role` أو `is_active` إطلاقاً**.
- **سيناريو الاستغلال:** كاشير يملك مفتاح anon key + جلسة تسجيل دخول صالحة يرسل طلب مباشر لواجهة Supabase (بدون المرور بواجهة التطبيق):
  ```bash
  curl -X PATCH 'https://<project>.supabase.co/rest/v1/profiles?id=eq.<own-uuid>' \
    -H "apikey: <anon-key>" -H "Authorization: Bearer <cashier-jwt>" \
    -H "Content-Type: application/json" \
    -d '{"role":"admin"}'
  ```
  الشرطان (`auth.uid() = id` و`store_id` بدون تغيير) صحيحان، فينجح التحديث ويصبح الكاشير أدمن دائم في متجره — يفتح كل الصفحات والصلاحيات الإدارية (تعديل الأسعار، إدارة الموظفين، التقارير المالية، الموردين).
- **الإصلاح المقترح:**
  ```sql
  drop policy if exists "self update profile" on profiles;
  create policy "self update profile" on profiles for update to authenticated
    using (auth.uid() = id)
    with check (
      auth.uid() = id
      and store_id = current_store_id()
      and role = (select role from profiles where id = auth.uid())
      and is_active = (select is_active from profiles where id = auth.uid())
    );
  -- تحصين إضافي على مستوى الأعمدة، بنفس نمط جدول stores:
  revoke update on profiles from authenticated;
  grant update (full_name) on profiles to authenticated;
  ```

### 🟠 مرتفع — الكاشير يقدر يعدّل/يحذف أي وحدة بيع (`product_units`) مباشرة — نفس ثغرة `products` القديمة لكن نُسي هذا الجدول
- **الملف/السطر:** `supabase/migrations/00000000000012_multi_tenancy_foundation.sql:225-227` — لم تُلمس هذه السياسة في migration 23 (التي أصلحت `products`/`categories` فقط)
- **الوصف:** `product_units` لا تزال بسياسة واحدة `for all` بدون تفريق دور: `using (store_id = current_store_id()) with check (store_id = current_store_id())`.
- **سيناريو الاستغلال:** كاشير يستدعي `PATCH /rest/v1/product_units?id=eq.<uuid>` لتغيير `sale_price` لوحدة كرتون/كيس معينة، أو `DELETE` للوحدة كاملة — بدون أي فحص دور. `ProductUnitsManager.tsx` لا يملك أي حماية دور بالواجهة أيضاً، يعني الثغرة حقيقية على مستوى القاعدة وليست مجرد إخفاء زر بالواجهة.
- **الإصلاح المقترح:** تطبيق نفس نمط migration 23:
  ```sql
  drop policy if exists "authenticated all product_units" on product_units;
  create policy "authenticated select product_units" on product_units for select to authenticated
    using (store_id = current_store_id());
  create policy "authenticated insert product_units" on product_units for insert to authenticated
    with check (store_id = current_store_id());
  create policy "admin update product_units" on product_units for update to authenticated
    using (store_id = current_store_id() and exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
    with check (store_id = current_store_id() and exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
  create policy "admin delete product_units" on product_units for delete to authenticated
    using (store_id = current_store_id() and exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
  ```

### 🟠 مرتفع — الكاشير يقدر يعدّل/يحذف أي فاتورة مبيعات سابقة (تلاعب بالسجل المالي)
- **الملف/السطر:** `supabase/migrations/00000000000012_multi_tenancy_foundation.sql:216-222` (سياسات `sales`/`sale_items`)
- **الوصف:** كلا الجدولين ما زالا بسياسة `for all` مقيّدة فقط بالمتجر، بلا قيد دور أو حماية من التعديل/الحذف بعد التسجيل. تم التأكد أن التطبيق نفسه **لا يستدعي** `UPDATE`/`DELETE` على أي منهما إطلاقاً (الفواتير من المفترض أن تكون ثابتة، والتصحيح يتم عبر جدول `returns`).
- **سيناريو الاستغلال:** كاشير يستدعي القاعدة مباشرة ليعدّل `total_amount`/`discount_amount`/`paid_amount` لفاتورة قديمة، أو يحذف صفوف `sale_items` — مثلاً لإخفاء عجز في التسوية اليومية أو حذف أثر بيعة كبيرة قبل تقفيل الوردية.
- **الإصلاح المقترح:** قصر الصلاحية على القراءة والإدراج فقط للجميع (لا حاجة تعديل/حذف حتى للأدمن، فالتصحيح يمر عبر `returns`):
  ```sql
  drop policy if exists "authenticated all sales" on sales;
  create policy "authenticated select sales" on sales for select to authenticated using (store_id = current_store_id());
  create policy "authenticated insert sales" on sales for insert to authenticated with check (store_id = current_store_id());

  drop policy if exists "authenticated all sale_items" on sale_items;
  create policy "authenticated select sale_items" on sale_items for select to authenticated using (store_id = current_store_id());
  create policy "authenticated insert sale_items" on sale_items for insert to authenticated with check (store_id = current_store_id());
  ```

### 🟠 مرتفع — تقفيل الوردية قابل للتلاعب المباشر عبر القاعدة (إخفاء عجز الصندوق)
- **الملف/السطر:** `supabase/migrations/00000000000018_cash_drawer_shifts.sql:44-52`
- **الوصف:** سياسة تحديث `shifts` تتحقق فقط من `store_id`، بلا شرط `status = 'open'` وبلا قيد على أي الأعمدة يمكن تغييرها. منطق حساب `expected_amount`/`difference` الصحيح موجود فقط في كود التطبيق (`services/shifts.service.ts`)، وليس محمياً على مستوى القاعدة.
- **سيناريو الاستغلال:** كاشير يستدعي `PATCH` مباشر على صف الوردية الخاص به (حتى لو كان مُقفلاً مسبقاً) ويضع `difference = 0` لإخفاء عجز حقيقي بالصندوق، أو يعيد فتح وردية مُقفلة ويلاعب بسجلها التاريخي.
- **الإصلاح المقترح:** نقل تقفيل الوردية إلى دالة `security definer` (بنفس نمط `record_return`) تحسب `expected_amount` داخلياً وتتحقق أن `status = 'open'` و`cashier_id = auth.uid()` كشرط داخلي، ثم منع التعديل المباشر على الجدول للكاشير كلياً.

### 🟡 متوسط — دالة `receive_product_stock` معطّلة صامتاً للكاشير بعد تحصين `products` (أثر جانبي غير مقصود لإصلاح سابق)
- **الملف/السطر:** `supabase/migrations/00000000000008_receive_product_stock.sql:12-25` مقابل `00000000000023_admin_only_product_category_writes.sql:49-57`
- **الوصف:** هذه الدالة ما زالت `security invoker` وتعتمد على RLS الخاص بالمستدعي لتعمل. بعد أن أصبح تعديل `products` حصراً للأدمن (migration 23)، أصبح استدعاء الكاشير لهذه الدالة يُحدّث صفراً من الصفوف صامتاً (فشل بلا رسالة واضحة)، بينما نموذج `ReceiveStockForm.tsx` يفترض أن الكاشير مستخدم شرعي لها. هذا عطل وظيفي (فشل آمن وليس ثغرة أمنية بحد ذاتها) لكنه يستحق الإصلاح بنفس الأسلوب الآمن قبل أن يُحل لاحقاً بترقيع غير آمن.
- **الإصلاح المقترح:** تحويلها إلى `security definer` مع فحص يدوي لـ `store_id`، بنفس ما تم مع `adjust_product_stock`.

### 🟡 متوسط — دالة `record_return` تثق بقيم `p_store_id`/`p_actor_id` القادمة من العميل بدلاً من اشتقاقها من الجلسة
- **الملف/السطر:** `supabase/migrations/00000000000021_atomic_return_recording.sql:50-62,96` و`services/returns.service.ts:53-70`
- **الوصف:** الدالة تتحقق أن `sale_item.store_id` يطابق `p_store_id` الممرر — لكن `p_store_id` و`p_actor_id` أنفسهما قيم يرسلها العميل (من `useAuth().storeId`) وليستا مُشتقّتين داخلياً من `auth.uid()`/`current_store_id()`.
- **سيناريو الاستغلال:** كاشير يستدعي `supabase.rpc('record_return', {...})` مباشرة ويمرر `p_store_id` مزوّراً (متجر آخر إذا استطاع تخمين/تسريب `sale_item_id` ينتمي له) أو `p_actor_id` مزوّراً لتلفيق مرتجع باسم موظف آخر.
- **الإصلاح المقترح:** اشتقاق القيمتين داخل الدالة نفسها (`v_store_id := current_store_id(); v_actor_id := auth.uid();`) وحذف المعاملين من التوقيع بدلاً من الثقة بهما من الخارج.

### 🟡 متوسط — جداول الموردين (`suppliers`/`supplier_transactions`/`stock_purchases`) قابلة للقراءة والكتابة من أي كاشير رغم أن الواجهة تخصّصها للمالك فقط
- **الملف/السطر:** `supabase/migrations/00000000000016_suppliers.sql:35-94`, `00000000000017_stock_purchase_supplier_link.sql:42-46` — مقابل `app/(dashboard)/suppliers/page.tsx:32-39` التي تعرض صراحة "هذي الصفحة للمالك فقط"
- **سيناريو الاستغلال:** كاشير يستدعي القاعدة مباشرة ليقرأ كامل سجل ديون الموردين، أو يُدخل دفعة وهمية لمورد، أو يعدّل بيانات مورد — كل ذلك رغم حجب الواجهة له.
- **الإصلاح المقترح:** إضافة شرط دور أدمن على عمليات الكتابة (والقراءة إذا كان سجل الديون يُراد أن يبقى حصراً للمالك)، بنفس نمط الإصلاحات السابقة.

### ✅ تم التحقق (لا توجد مشكلة)
- فصل صلاحيات الأدمن/الكاشير على `products`/`categories` (migration 23) — ما زال سارياً حتى آخر migration.
- تحويل `adjust_product_stock` إلى `security definer` مع فحص المتجر اليدوي — سليم.
- حماية جدول `stores` بالكامل + تقييد التعديل الذاتي على أعمدة `name/phone/address` فقط عبر `grant update` — سليم.
- `current_store_id()` يفشل بأمان (fail-closed) عند متجر معلّق أو حساب محذوف — سليم.
- `handle_new_user()` يتحقق من وجود `store_id` فعلياً قبل منح أي دور — سليم.
- سقف مبلغ الاسترجاع + قفل الصف الذري في `record_return` (باستثناء ثغرة `p_store_id`/`p_actor_id` أعلاه) — سليم.
- صلاحيات `customers`/`customer_transactions` مفتوحة لكل كاشير بلا فصل دور — هذا **متوافق مع التصميم المقصود** (المبيعات الآجلة مهمة كاشير عادية)، وليس ثغرة.
- مسارات `app/api/employees/*` تتحقق من الدور والمتجر عبر الخادم بشكل صحيح، ولا تسمح بتغيير `role`.

---

## 2️⃣ مدقق الهويات والصلاحيات (Auth & IAM Auditor)

**النطاق:** `middleware.ts`، `lib/supabase/middleware.ts`، `app/api/employees/*`، `AuthContext`، وكل صفحات الواجهة ذات حماية دور.

### 🔴 حرج — نفس ثغرة تصعيد الصلاحيات أعلاه، مؤكدة بشكل مستقل من زاوية IAM
- **الملف/السطر:** `supabase/migrations/00000000000012_multi_tenancy_foundation.sql:187-190`
- **ملاحظة:** هذا العميل توصّل لنفس ثغرة "الكاشير يرفّع نفسه إلى أدمن" بشكل مستقل تماماً عن مفتش قواعد البيانات، بنفس السيناريو والإصلاح المذكورين أعلاه — انظر القسم 1️⃣ لتفاصيل الكود الكامل. **التوافق بين العميلين يرفع درجة الثقة بأن هذه الثغرة حقيقية وذات أولوية قصوى.**

### 🟠 مرتفع — صفحات إدارية محمية بإخفاء واجهة فقط، وصلاحيات القاعدة خلفها لا تفرّق الدور (5 مواضع)
- **الملفات:**
  - `app/(dashboard)/employees/page.tsx`, `employees/[id]/page.tsx` ← `profiles` (قراءة) و`operations_log` (سجل التدقيق) مفتوحان لأي كاشير بنفس المتجر
  - `app/(dashboard)/sales/page.tsx`, `shifts/page.tsx` ← `sales`/`sale_items`/`shifts` مفتوحة للقراءة لأي كاشير (تقارير أرباح وهوامش كاملة، وسجل ورديات كل الموظفين)
  - `app/(dashboard)/suppliers/page.tsx` (مكرر مع بند مفتش القواعد أعلاه)
- **سيناريو الاستغلال:** كاشير يفتح Developer Tools ويستدعي واجهات REST مباشرة لهذه الجداول، فيحصل على تقارير الأرباح والهوامش الكاملة، سجل رواتب/ورديات الموظفين الآخرين، وسجل التدقيق الكامل (من فعل ماذا) — رغم أن صفحات الواجهة تمنعه من الدخول أصلاً.
- **الإصلاح المقترح:** تطبيق نفس نمط `admin-only` المستخدم مسبقاً لـ `products`/`categories`/`stores` على `operations_log`، `sales`/`sale_items` (أو على الأقل أعمدة التكلفة/الربح)، و`shifts` (مع الانتباه أن الكاشير يحتاج شرعياً قراءة ورديته الخاصة فقط):
  ```sql
  drop policy if exists "authenticated read operations_log" on operations_log;
  create policy "admin read operations_log" on operations_log for select to authenticated
    using (
      store_id = current_store_id()
      and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    );
  ```

### 🟢 منخفض — سياسة كلمة المرور ضعيفة (6 أحرف كحد أدنى فقط)
- **الملف/السطر:** `app/api/employees/[id]/route.ts:63-65`
- **الوصف:** ليست ثغرة تصعيد صلاحيات بحد ذاتها، بل ضعف بسياسة كلمة المرور يستحق تحسيناً مستقبلاً (8+ أحرف، تنويع، إلخ) — أضيفت هنا لأنها ضمن نفس مسار التدقيق ولن تُدرج بتقرير منفصل.

### ✅ تم التحقق (لا توجد مشكلة)
- `middleware.ts`/`lib/supabase/middleware.ts`: الجلسة تُتحقّق منها فعلياً عبر `supabase.auth.getUser()` (اتصال حقيقي بخادم Supabase، وليس مجرد فك تشفير كوكي محلي)، والدور لا يُقرأ أبداً من كوكي أو قيمة يتحكم بها العميل.
- تعليق المتجر (`is_active = false`) يُفحص بالخادم عبر مفتاح الخدمة (service-role) تحديداً، لتفادي التباس "متجر معلّق" مع "خطأ اتصال عابر" — سياسة "فشل مفتوح عند الشك، فشل مغلق عند التأكد" مطبّقة بشكل صحيح.
- `app/api/employees/route.ts` (إنشاء موظف): `store_id` يُشتق من جلسة الأدمن على الخادم فقط، لا يقبل أي `store_id` من جسم الطلب — يمنع زرع مستخدم بمتجر آخر.
- `app/api/employees/[id]/route.ts` (تعديل/حذف): يتحقق أن الهدف بنفس متجر الأدمن قبل أي تعديل — يمنع أدمن متجر (أ) من التلاعب بموظف متجر (ب).
- حماية "لا يمكن للأدمن تعديل/تعطيل حسابه الخاص عبر هذا المسار" (`isSelfTarget`/`isSelfLockout`) مطبّقة فعلياً على الخادم، وليست إخفاء واجهة فقط.
- إعادة تعيين كلمة المرور تمر بنفس مسار `PATCH` المحمي بالكامل — لا يوجد مسار منفصل غير محمي.
- `handle_new_user()` لا يقرأ دوراً من العميل إطلاقاً؛ الدور يُشتق من "هل هذا أول حساب بهذا المتجر" فقط.

---

## 3️⃣ محلل أمان الواجهات والبيانات المحلية (Frontend & Offline Data Analyst)

**النطاق:** التحقق أولاً من وجود نظام Offline حقيقي (تم تأكيده)، ثم فحص التلاعب بالبيانات المحلية وXSS.

### 🔴 حرج — تلاعب بسعر/كمية المنتج عبر تعديل ذاكرة IndexedDB المحلية (تأكيد مستقل، انظر أيضاً بند مراقب النزاهة المالية)
- **الملف/السطر:** `lib/offline/productCache.ts:22-88`, `hooks/usePOS.ts:36-71`, `lib/offline/syncManager.ts:34-148`
- **الوصف:** نظام العمل دون اتصال حقيقي وموجود فعلاً (`lib/offline/db.ts` + `idb-keyval`)، وليس PWA/service worker كامل. عند الإضافة للسلة، تُقرأ بيانات المنتج من نسخة IndexedDB المخزّنة محلياً (`getCachedCatalog()`) وتُستخدم مباشرة (`sale_price`/`cost_price`) دون أي تحقق لاحق. عند عودة الاتصال، دالة المزامنة (`syncOutbox`) تعيد التحقق من **المخزون فقط** (عبر `adjust_product_stock`) لكنها **لا تعيد التحقق من السعر إطلاقاً** قبل إرسال البيع النهائي للخادم.
- **سيناريو الاستغلال:** كاشير يفتح أدوات المطوّر (DevTools) → Application → IndexedDB، ويُعدّل يدوياً سعر منتج مخزّن (مثلاً من 500 إلى 1)، ثم يمسح المنتج ويُكمل عملية بيع — سواء كان فعلاً بدون اتصال أو حتى بمحاكاة ذلك (`navigator.onLine` يمكن تزييفه بسهولة). عند المزامنة، يُسجَّل البيع بالسعر المُلفَّق بشكل دائم في قاعدة البيانات.
- **الإصلاح المقترح:** إعادة جلب السعر/التكلفة الحقيقيين من جدول `products` (أو `product_units`) عند المزامنة قبل الإدراج، بدلاً من الثقة بالقيمة المخزّنة محلياً:
  ```ts
  async function repriceSaleFromServer(supabase, sale) {
    const items = await Promise.all(sale.payload.items.map(async (item) => {
      const product = await getProductById(supabase, item.productId);
      if (!product) throw new Error(`Product ${item.productId} no longer exists`);
      return { ...item, unitPrice: product.sale_price, costPrice: product.cost_price };
    }));
    return { ...sale.payload, items };
  }
  ```

### 🔴 حرج — نفس مشكلة الثقة بسعر العميل موجودة أيضاً في مسار الدفع العادي (أونلاين، وليس فقط أوفلاين) — انظر تفاصيل الإصلاح الكاملة في قسم "مراقب النزاهة المالية" أدناه لتفادي التكرار

### ✅ تم التحقق (لا توجد مشكلة)
- **XSS:** لا يوجد أي استخدام لـ `dangerouslySetInnerHTML` أو `innerHTML` أو `eval(`/`new Function(` بكامل المشروع (تم التحقق بالبحث الشامل، بما فيها مكوّنات الطباعة `ReceiptPrinter.tsx`/`CustomerStatementPrinter.tsx` تحديداً حيث تُعرض كل النصوص الحرة كنص JSX عادي محمي تلقائياً من React).
- **localStorage:** المفتاح الوحيد المُستخدم هو `dddmart:pos-sound-muted` (كتم الصوت فقط) — لا توجد رموز جلسة أو أدوار أو أسعار مخزّنة محلياً بشكل غير آمن.
- **ماسح الباركود** (يدوي HID وكاميرا): كلاهما يُنتج نص باركود خام فقط يُستخدم للبحث في القاعدة الحقيقية (`resolveBarcode`)، وليس مصدراً مباشراً للسعر أو الهوية — الثغرة الوحيدة المرتبطة هي عبر ذاكرة Offline المذكورة أعلاه، وليست بالماسح نفسه.

---

## 4️⃣ مراقب النزاهة المالية (Financial Integrity Monitor)

**النطاق:** منطق الدفع، الخصومات، المرتجعات، وإدارة المخزون — بالإضافة للتحقق الصريح من سريان كل إصلاحات التدقيق السابق (2026-09-06/07).

### التحقق من الإصلاحات السابقة — جميعها ✅ سليمة وسارية
| البند السابق | الحالة |
|---|---|
| `record_return` RPC ذرّي مع قفل صف وسقف استرجاع | ✅ سليم |
| حدود مبلغ الخصم (`CHECK` + تحقق خادم + واجهة) | ✅ سليم |
| `flushPendingQuantityTimers()` عند حذف/تفريغ/دفع/تعليق السلة | ✅ سليم |
| منع القيم السالبة لسعر التكلفة/البيع | ✅ سليم |
| معالجة خطأ فشل الدفع (try/catch + رسالة + إبقاء النافذة مفتوحة) | ✅ سليم |

### 🔴 حرج — الدفع يقبل سعراً محسوباً من العميل بدون إعادة حساب من الخادم (تأكيد مستقل، مرتبط ببند محلل الواجهة أعلاه)
- **الملف/السطر:** `services/sales.service.ts:17-30` (`buildSaleItemRows`) و`services/sales.service.ts:203-281` (`createSale`)
- **الوصف:** عملية الدفع بالكامل تتم من المتصفح مباشرة (لا يوجد API route وسيط)، و`createSale` تُدرج صفوف `sale_items` باستخدام `unitPrice`/`costPrice` كما وصلت من حالة السلة بالمتصفح، دون أي إعادة جلب أو تحقق من `products.sale_price`/`cost_price` الحقيقيين وقت الدفع. لا توجد قيود `CHECK` على تطابق السعر مع الكتالوج (فقط قيود عدم السالبية وحدود الخصم).
- **سيناريو الاستغلال:** كاشير (أو أي سكربت يستخدم جلسته الحقيقية) يستدعي `createSale`/إدراج مباشر على `sale_items` بسعر وحدة أقل بكثير من السعر الفعلي بالكتالوج — تمر العملية بنجاح لأن RLS يتحقق فقط من `store_id`. النتيجة: اختلاس داخلي (البضاعة تخرج بكامل قيمتها، لكن الفاتورة المسجَّلة بسعر مخفَّض) لا يظهر كخطأ ولا كخصم في أي تقرير، ويُضعف كل تقارير الأرباح اللاحقة (`getDailySalesSummary`, `getProductRanking`, ...) التي تثق بـ `sale_items.unit_price`/`cost_price` كمصدر حقيقة.
- **الإصلاح المقترح:** تحويل عملية إنشاء البيع لدالة `security definer` (على نمط `record_return`) تعيد جلب السعر/التكلفة من `products`/`product_units` بنفسها لكل سطر، وتتجاهل أي سعر يرسله العميل تماماً:
  ```sql
  select sale_price, cost_price into v_price, v_cost
    from products where id = p_product_id and store_id = p_store_id;
  if not found then raise exception 'المنتج غير موجود'; end if;
  insert into sale_items (..., unit_price, cost_price, total_price, ...)
  values (..., v_price, v_cost, v_price * p_quantity, ...);
  ```
  كحل مرحلي أسرع (دفاع إضافي وليس بديلاً كاملاً)، يمكن إضافة قيود `CHECK` على `sale_items`/`sales` بنفس نمط إصلاح الخصم السابق:
  ```sql
  alter table sale_items
    add constraint sale_items_unit_price_nonnegative check (unit_price >= 0),
    add constraint sale_items_total_price_matches check (total_price = unit_price * quantity);
  ```

### 🟡 متوسط — سباق تزامن (Race Condition) في تسوية الجرد قد يُطبّق تصحيحاً خاطئاً للمخزون
- **الملف/السطر:** `services/reconciliations.service.ts:31-53` (`recordReconciliation`)
- **الوصف:** الدالة تقرأ `product.quantity` الحالية أولاً، تحسب الفرق (`countedQuantity - previousQuantity`) في كود التطبيق، ثم تستدعي `adjust_product_stock` بطلب منفصل. إذا تغيّر المخزون بين الخطوتين (مثلاً عملية بيع متزامنة من كاشير آخر)، يُطبَّق الفرق المحسوب على قيمة مخزون لم تعد صحيحة، فتنتج كمية نهائية مختلفة عن العدّ الفعلي الذي أدخله الموظف — وتُسجَّل بيانات خاطئة بشكل دائم في سجل `stock_reconciliations` وقيمة `loss_value` المشتقة منها.
- **سيناريو الاستغلال (غير مقصود وليس احتيالاً بالضرورة، لكنه يفسد دقة السجل المالي):** موظف يفتح شاشة تسوية لمنتج رصيده المعروض 50، يُدخل عدّاً فعلياً 45 (فرق -5) في نفس اللحظة التي يبيع فيها كاشير آخر 3 قطع من نفس المنتج عبر جهاز آخر — تُطبَّق -5 على الرصيد اللحظي (47) فينتج 42 بدلاً من 45 الصحيح، دون أي رسالة خطأ.
- **الإصلاح المقترح:** تمرير الكمية المعدودة فعلياً (وليس الفرق المحسوب مسبقاً) لدالة ذرية واحدة تقفل الصف وتحسب الفرق داخلياً في نفس اللحظة:
  ```sql
  create or replace function public.record_reconciliation(
    p_product_id uuid, p_counted_quantity integer, p_store_id uuid, ...
  ) returns setof stock_reconciliations
  language plpgsql security definer set search_path = public as $$
  declare v_product products%rowtype;
  begin
    select * into v_product from products
      where id = p_product_id and store_id = p_store_id for update;
    if not found then raise exception 'تعذر العثور على المنتج'; end if;
    -- الفرق يُحسب هنا، على الصف المقفول للتو، وليس من قراءة سابقة منفصلة
    ...
  end; $$;
  ```

### 🟡 متوسط — تقفيل الوردية بدون حماية ذرية من التزامن المزدوج (مرتبط ببند مفتش القواعد أعلاه من زاوية مختلفة)
- **الملف/السطر:** `services/shifts.service.ts:164-211` (`closeShift`)
- **الوصف:** الدالة تقرأ حالة الوردية (`select`)، ثم تُحدّثها (`update`) بطلب منفصل بدون شرط `WHERE status = 'open'` وبدون قفل صف — لا يوجد ما يمنع تنفيذ إغلاقين متزامنين لنفس الوردية (مثلاً: كاشير يُغلق وردية بنفسه بنفس لحظة إغلاق قسري من الأدمن لنفس الوردية من جهاز آخر).
- **سيناريو الاستغلال:** كلا الطلبين يقرآن `status: 'open'` قبل أن يكتب أي منهما، وكلاهما يمرّان من فحص `if (status === "closed") throw`، فيُنفَّذ كلا التحديثين، وآخر كتابة تفوز — قد تُمحى بيانات عدّ نقدي حقيقي (وفرقه المكتشف) بإغلاق قسري لاحق بلا عدّ، مما يُضيع إشارة عجز/فائض حقيقية كان الغرض من تقفيل الوردية اكتشافها.
- **الإصلاح المقترح:** جعل التحديث مشروطاً ببقاء الوردية مفتوحة، والتحقق أن التحديث أثّر فعلاً على صف واحد:
  ```ts
  const { data: updated, error } = await supabase
    .from("shifts")
    .update({ status: "closed", ... })
    .eq("id", params.shiftId)
    .eq("status", "open")   // شرط يمنع الكتابة إذا أُغلقت الوردية بالفعل
    .select().single();
  ```
  (الحل الأمثل: تحويلها لدالة `security definer` بقفل صف حقيقي `for update`، بنفس نمط `record_return`.)

### ✅ تم التحقق (لا توجد مشكلة)
- استرجاع مبالغ عبر متجر آخر (Cross-tenant): غير قابل للاستغلال — `record_return` يتحقق من تطابق `store_id` (باستثناء ثغرة الثقة بـ`p_store_id` المذكورة بقسم مفتش القواعد).
- استرجاع مزدوج لنفس الكمية: غير قابل للاستغلال — قفل الصف الذري يمنع التزامن على نفس السطر.
- سجل التلف والتسوية (`stock_damages`/`stock_reconciliations`/`returns`): كلها فعلياً Append-only (لا صلاحية `UPDATE`/`DELETE` على أي منها)، ومنسوبة لموظف محدد دائماً.
- بيع آخر قطعة متبقية من جهازين متزامنين: غير قابل للاستغلال — `adjust_product_stock` تحديث ذري واحد بشرط `quantity + delta >= 0`، يقفل الصف تلقائياً في Postgres.
- الفارق بين المبلغ المتوقع والمُعلَن عند تقفيل الوردية: يُحسب ويُخزَّن دائماً (لا يُهمَل صامتاً) — الثغرة الوحيدة هي سباق التزامن المذكور أعلاه، وليس إخفاء الفارق.

---

## ملحق: خريطة الثغرات المشتركة بين العملاء

بعض الثغرات اكتُشفت بزوايا مختلفة من أكثر من عميل — وهذا يزيد الثقة بأولوية إصلاحها:

| الثغرة | اكتُشفت من |
|---|---|
| تصعيد صلاحيات الكاشير إلى أدمن عبر `profiles` | مفتش قواعد البيانات + مدقق الهويات (بشكل مستقل تماماً) |
| السعر المُدخل بالدفع غير مُتحقق منه بالخادم | محلل الواجهة/الأوفلاين + مراقب النزاهة المالية (بشكل مستقل تماماً) |
| صلاحيات الموردين مفتوحة رغم حجب الواجهة | مفتش قواعد البيانات + مدقق الهويات |
| سباق تزامن عند تقفيل الوردية | مفتش قواعد البيانات (زاوية RLS) + مراقب النزاهة المالية (زاوية التزامن) |
