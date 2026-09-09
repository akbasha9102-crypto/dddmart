# تقرير فحص أمني متعدد الوكلاء — مشروع DDD Mart

**التاريخ:** 2026-09-09
**النطاق:** الأمان المالي، حماية البيانات، وتصعيد الصلاحيات فقط (لا يشمل الأخطاء البرمجية العامة)
**المنهجية:** فريق افتراضي من 4 خبراء أمن (Red Team) عمل بالتوازي، كل عميل مختص بمجال مستقل، مع تتبع كل جدول/دالة إلى **آخر نسخة فعلية** لها عبر ملفات الهجرة (migrations) بدلاً من أول تعريف لها.
**ملاحظة هامة:** هذا الكود سبق أن خضع لعدة جولات تدقيق أمني سابقة (`mashee_mart_security_audit.md`, `mashee_mart_general_audit.md`, `mashee_mart_audit_report.md`). معظم الثغرات الكلاسيكية (RLS مفقود، ثقة بالسعر القادم من العميل، تصعيد صلاحيات عبر التسجيل الذاتي) وُجدت ومعالجة سابقاً. هذا التقرير يوثّق الفجوات **المتبقية فعلياً** بعد التحقق المستقل، ولا يعيد ذكر ما تم إصلاحه إلا للسياق.
**حالة الملف:** للقراءة فقط (Read-only) — لم يتم تعديل أي كود، ولم يتم عمل Commit/Push بناءً على طلب صاحب المشروع (لأن مستودع GitHub الخاص بالمشروع **عام/Public**، ونشر تفاصيل استغلال الثغرات فيه يشكل خطورة إضافية).

---

## جدول ملخص الثغرات حسب الأولوية

| # | الخطورة | الثغرة | العميل المكتشف |
|---|---------|--------|------------------|
| 1 | 🔴 عالية | تصعيد مخزون عبر `record_return` بتزوير `unit_conversion_factor`/`product_id` | مراقب النزاهة المالية |
| 2 | 🟠 متوسطة/عالية | تزوير سجلات `stock_damages` (فاقد/تلف) بدون ربط فعلي بخصم المخزون | مفتش قواعد البيانات |
| 3 | 🟡 منخفضة | انحراف فاتورة المبيعات دون اتصال (Offline) عن السعر الفعلي المسجّل عند المزامنة | محلل البيانات المحلية |
| 4 | 🟡 منخفضة (دفاع بالعمق) | إدخال أسعار من العميل مباشرة في `held_sales` بدون إعادة تسعير من الخادم | محلل البيانات المحلية |
| 5 | 🟢 منخفضة جداً (كود غير مُستخدم) | دالة `adjustStock` تحتوي على Race Condition كلاسيكي لكنها غير مستدعاة من أي مكان حالياً | مراقب النزاهة المالية |
| 6 | ℹ️ معلوماتي | `held_sales.cashier_id` قابل للتزوير من العميل (لا يوجد أثر مالي، سلوك مقصود) | مفتش قواعد البيانات |
| — | ✅ لا يوجد | تصعيد صلاحيات عبر Auth/Middleware/API الموظفين | مدقق الهويات والصلاحيات |

**فجوة تغطية إضافية (ليست ثغرة):** مجلد `supabase/tests/` يحتوي على ملفي اختبار فقط، ولا يوجد أي اختبار آلي (regression test) يتحقق من عزل المتاجر (tenant isolation) أو رفض الأدوار على مستوى RLS. يُنصح بإضافتها.

---

## العميل الأول: مفتش قواعد البيانات (DB & RLS Inspector)

**النطاق:** جميع ملفات `supabase/migrations/` (38 ملف)، تم تتبع كل جدول إلى آخر سياسة RLS فعلية له، بالإضافة إلى `supabase/tests/`.

### 1. تزوير سجلات "التلف/الفاقد" (`stock_damages`) بدون ربط حقيقي بخصم المخزون

- **اسم الثغرة:** Cashier-Forgeable Stock Loss Records (Broken Ledger Integrity)
- **الملف والسطر:** `supabase/migrations/00000000000009_returns_and_damage.sql:57-58` (السياسة الحالية النهائية، لم يعدّلها أي ملف لاحق سوى إضافة تحقق `store_id` في الهجرة 12)
- **الوضع الحالي:**
  ```sql
  create policy "authenticated insert stock_damages" on stock_damages for insert to authenticated
    with check (store_id = current_store_id());
  ```
- **سيناريو الاستغلال:** التدفق الشرعي في `services/damages.service.ts#recordDamage` يستدعي أولاً RPC آمنة (`adjust_product_stock`) لخصم المخزون فعلياً، ثم بشكل منفصل يُدخل صفاً في `stock_damages`. هاتان عمليتان مستقلتان تماماً وغير ذريتين (non-atomic) — لا يوجد أي رابط في قاعدة البيانات بينهما. يمكن لكاشير خبيث بامتلاكه JWT صالح أن يتجاوز استدعاء الـ RPC تماماً وينفّذ `POST /rest/v1/stock_damages` مباشرة بـ:
  - `product_id` حقيقي من متجره (يمرّ من فحص `store_id`)،
  - أي `quantity`/`cost_price`/`loss_amount` يختارها (RLS لا يتحقق إلا من `store_id`)،
  - أي `actor_id` (بما فيه معرّف زميل آخر لتلفيق تهمة "الفاقد" عليه)،
  دون حدوث أي خصم فعلي من `products.quantity`. هذا يسمح بـ: (أ) تضخيم الفاقد المُسجَّل لتبرير مخزون سُرق أو بيع فعلياً دون تسجيله رسمياً، (ب) تلفيق `loss_amount` غير مرتبط بالتكلفة الحقيقية للمنتج لتشويه تقارير الربح/الخسارة. لاحظ أن جدول `returns` المشابه له تمت معالجة نفس الفئة من الثغرة عبر RPC آمنة (`record_return`، الهجرات 21/35/37)، بينما `stock_damages` لم يحصل على نفس المعالجة.
- **كود الإصلاح المقترح (SQL):**
  ```sql
  -- محاكاة نمط record_return: RPC واحدة تصبح الطريقة الوحيدة لتسجيل التلف،
  -- تربط خصم المخزون وإدخال السجل معاً بشكل ذري، وتشتق actor_id/store_id
  -- من الخادم، وتسعّر loss_amount من cost_price الحقيقي تحت قفل صف.
  create or replace function public.record_damage(
    p_product_id uuid,
    p_product_name text,
    p_quantity integer,
    p_reason text
  )
  returns setof stock_damages
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_product products%rowtype;
    v_loss_amount numeric;
  begin
    if p_quantity <= 0 then
      raise exception 'الكمية يجب أن تكون أكبر من صفر';
    end if;

    select * into v_product from products where id = p_product_id for update;
    if not found then
      raise exception 'تعذر العثور على المنتج';
    end if;

    if v_product.store_id <> current_store_id() then
      raise exception 'المنتج لا يتبع هذا المتجر';
    end if;

    if v_product.quantity < p_quantity then
      raise exception 'الكمية أكبر من المخزون المتوفر (المتوفر: %)', v_product.quantity;
    end if;

    update products
    set quantity = quantity - p_quantity,
        updated_at = now()
    where id = p_product_id;

    v_loss_amount := p_quantity * v_product.cost_price;

    return query
      insert into stock_damages (
        product_id, product_name, quantity, cost_price, loss_amount,
        reason, actor_id, store_id
      )
      values (
        p_product_id, p_product_name, p_quantity, v_product.cost_price,
        v_loss_amount, p_reason, auth.uid(), current_store_id()
      )
      returning *;
  end;
  $$;

  grant execute on function public.record_damage(uuid, text, integer, text) to authenticated;

  -- إغلاق الكتابة المباشرة الآن بعد أن أصبحت الـ RPC هي المسار الوحيد
  drop policy if exists "authenticated insert stock_damages" on stock_damages;
  ```

### 2. `held_sales.cashier_id` قابل للتزوير من العميل (معلوماتي فقط)

- **اسم الثغرة:** Client-Supplied Actor Identity on `held_sales`
- **الملف والسطر:** `supabase/migrations/00000000000010_hold_sale.sql:26-28` (عزل `store_id` صحيح ومُتحقق منه عبر الهجرة 12، لكن `cashier_id` غير مربوط بـ `auth.uid()`)
- **سيناريو الاستغلال:** `services/heldSales.service.ts#holdSale` يُدخل `cashier_id: params.cashierId` من حالة التطبيق مباشرة وليس من الجلسة. يمكن لكاشير استدعاء REST مباشرة وإدخال بيع معلّق منسوب لمعرّف زميل آخر. **التأثير منخفض جداً وغير مالي**: البيع المعلّق ميزة "صندوق مشترك" بالتصميم — أي مستخدم بنفس المتجر يمكنه أصلاً قراءة/حذف/إدخال أي بيع معلّق (مقصود حسب تعليقات الهجرة نفسها). لا يُعتبر ثغرة قابلة للاستغلال ماليا، ولم يُقترح إصلاح إلا إذا تغيّر القرار المنتجي مستقبلاً (مثل الاعتماد على `cashier_id` في نسب الورديات).

### ما تم فحصه ولم يظهر فيه أي ثغرة قابلة للاستغلال (تم التحقق والتأكد من إصلاحه في آخر هجرة)
- `profiles`: التصعيد الذاتي للأدمن مُغلق تماماً (الهجرة 26: حذف صلاحية UPDATE الذاتية + `revoke update`).
- `products/categories/product_units`: التعديل/الحذف حصري للأدمن (الهجرات 23، 28)، والعزل حسب `store_id` مُطبّق في كل مكان.
- `sales/sale_items`: الكتابة المباشرة محظورة تماماً؛ كل الكتابة تمر عبر `create_sale_atomic` (الهجرة 27) التي تُسعّر كل سطر من الخادم دون أي ثقة بسعر من العميل. `cost_price` مخفي عن غير الأدمن (الهجرة 34).
- `returns`: إغلاق تزوير `store_id`/`actor_id` عبر الهجرات 21→35→37.
- `stores`: قراءة فقط للمتجر الخاص، والتعديل مقتصر على الأدمن وأعمدة محددة فقط (الهجرة 15).
- `shifts`: الإغلاق يتم عبر `close_shift_atomic` (الهجرة 29) التي تحسب `expected_amount` بالكامل من الخادم.
- `suppliers/supplier_transactions/supplier_products`: حصري للأدمن بالكامل (الهجرة 33).
- `customers/customer_transactions`: معزولة حسب المتجر، ومنع استبدال `customer_id` عبر متاجر مختلفة في `create_sale_atomic`.
- `stock_reconciliations`: تم إغلاق Race Condition عبر `record_reconciliation` (الهجرة 36) بقفل صف حقيقي.
- `handle_new_user`: مُحصّن ضد تزوير `store_id` والتصعيد للأدمن (الهجرة 22).
- لا يوجد أي جدول بسياسة `using(true)` فعّالة حالياً، ولا أي جدول RLS مفعّل لكن بدون سياسات.

---

## العميل الثاني: مدقق الهويات والصلاحيات (Auth & IAM Auditor)

**النطاق:** `middleware.ts`، `lib/supabase/*`، `app/(auth)/login`، `app/api/employees/*`، `lib/employees/*`، `services/employees.service.ts`، `services/stores.service.ts`، وهجرات `profiles`/`stores`.

### النتيجة: لم يتم العثور على أي ثغرة قابلة للاستغلال

هذا الكود سبق أن خضع لتدقيق ومعالجة، وتم التحقق المستقل من كل نقطة:

1. **مسارات إنشاء/تعديل الموظفين تثق بالخادم لا بجسم الطلب:**
   `app/api/employees/route.ts` (POST) و`app/api/employees/[id]/route.ts` (PATCH) يستدعيان `requireAdmin()` أولاً (`lib/employees/requireAdmin.ts:19-36`)، والتي تشتق دور المستخدم ومتجره من قاعدة البيانات مباشرة عبر الجلسة الموثّقة، وليس من جسم الطلب. `store_id` للموظف الجديد مشتق من `admin.storeId` وليس من العميل (`app/api/employees/route.ts:42`)، ونوع جسم الطلب (`CreateEmployeeBody`) لا يقبل أصلاً حقل `role` أو `store_id`. مسار PATCH يتحقق أيضاً أن الصف المستهدف بنفس متجر المُستدعي قبل أي تعديل (الأسطر 80-93).
   **تحقّق فعلي:** طلب `curl` من كاشير بجلسة صالحة يُرفض بـ 403 من `requireAdmin()` قبل أي كتابة لقاعدة البيانات.

2. **التسجيل الذاتي (Signup):** لا يوجد أي صفحة/مسار تسجيل ذاتي في التطبيق إطلاقاً. الحسابات الجديدة تُنشأ فقط عبر أدمن موثّق مسبقاً باستخدام `auth.admin.createUser()`. التسجيل المباشر عبر Supabase (متجاوزاً التطبيق) معطّل على مستوى إعدادات المشروع، ومحصّن إضافياً بدالة `handle_new_user()` (الهجرة 22) التي ترفض أي `store_id` غير موجود فعلياً، و"أول مستخدم = أدمن" مقيّدة بكل `store_id` على حدة (لا يمكن الاستيلاء على متجر قائم فعلياً).

3. **الـ Middleware:** الـ matcher يغطي كل المسارات عدا الأصول الثابتة (بما فيها كل `/api/*`)، ولا يوجد أي مسار محمي يفلت من التحقق. الدور لا يُقرأ أبداً من كوكي/localStorage/معامل طلب — يُشتق دائماً من `profiles.role` عبر جلسة موثّقة من الخادم.

4. **فحص شامل (grep) لأي قراءة لـ `role`/`store_id` من جسم الطلب مباشرة:** لا يوجد أي مسار يستخدم قيمة كهذه من `request.json()`/`searchParams` لأي قرار تفويض أو نطاق بيانات.

**ملاحظة دفاع بالعمق (ليست ثغرة):** لا يوجد آلية مركزية (middleware مشترك) تفرض تلقائياً تكرار فحص `requireAdmin()` + التحقق من `store_id` على أي مسار جديد يُضاف مستقبلاً تحت `app/api/employees/` أو يستخدم `createAdminClient()`. يُنصح بتغليف هذا النمط في دالة مساعدة موحّدة عند توسّع واجهة API الخاصة بالموظفين.

---

## العميل الثالث: محلل البيانات المحلية والتلاعب (Local Data Tampering Analyst)

**النطاق:** `lib/offline/{db,outbox,productCache,syncManager}.ts`، `app/(dashboard)/pos/`، `services/sales.service.ts`، `services/heldSales.service.ts`، هجرات `*atomic*.sql`، `hooks/usePOS.ts`.

### الخلاصة العامة
تم تتبع تدفق البيانات كاملاً: سجل `outbox` (IndexedDB) يحتوي فعلاً على `unitPrice`/`costPrice` كاملة (تعديلها عبر أدوات المطوّر في المتصفح أمر بسيط فعلاً)، **لكن** `create_sale_atomic` (الهجرة 27) — وهي المسار الوحيد للكتابة في `sales`/`sale_items` — لا تقرأ إطلاقاً أي سعر من العميل؛ تشتق السعر من `products`/`product_units` بنفسها من `product_id` فقط. لذلك سيناريو "تعديل السعر محلياً ثم المزامنة كحقيقة" **غير قابل للتنفيذ فعلياً** ضد قاعدة البيانات — وهذا سبق معالجته صراحة في تعليق توثيقي داخل الهجرة 27 يشير إلى نتيجة تدقيق سابقة.

### 1. انحراف فاتورة المبيعات دون اتصال عن المبلغ الفعلي المسجّل عند المزامنة

- **اسم الثغرة:** Offline Receipt / Server-Recorded Total Divergence
- **الملف والسطر:** `hooks/usePOS.ts:334-396` (فرع الدفع دون اتصال)، بالمقارنة مع `services/sales.service.ts:193-249` و`supabase/migrations/00000000000027_atomic_sale_recording.sql:167-176`
- **سيناريو الاستغلال:** ليست ثغرة مالية على مستوى قاعدة البيانات (البيع الفعلي يُسعَّر دوماً بشكل صحيح عند المزامنة)، لكنها فجوة نزاهة/ثقة: أثناء العمل دون اتصال، تُبنى الفاتورة المطبوعة والمبلغ المعروض للكاشير من `cart.items` (المُحمَّلة من نسخة المنتجات المخزّنة محلياً `productCache.ts`). إن قام كاشير خبيث بتعديل `sale_price` المخزّن محلياً في IndexedDB (سهل عبر أدوات المطوّر) قبل قطع الاتصال، فإن **الفاتورة المطبوعة والمبلغ المطلوب من الزبون** سيعكسان السعر المزوَّر (مثلاً إجمالي 0.01)، بينما البيع الذي يصل فعلياً لقاعدة البيانات لاحقاً عبر `create_sale_atomic` سيُحسب بالسعر الحقيقي — تناقض صامت لا يُنبَّه له الكاشير عند المزامنة. يمكن لكاشير غير أمين استغلال هذا عمداً: تزوير السعر المخزّن مؤقتاً، تحصيل مبلغ حقيقي أعلى من الزبون بناءً على الفاتورة المزوَّرة المنخفضة، والاحتفاظ بالفرق، بينما يظهر النظام لاحقاً السعر الصحيح دون أي تنبيه واضح للتناقض وقت المزامنة.
- **كود الإصلاح المقترح:**
  ```ts
  // lib/offline/syncManager.ts، داخل try block بعد نجاح createSale:
  const persisted = await createSale(
    supabase,
    { ...sale.payload, id: sale.localId, invoiceNumber: sale.invoiceNumber },
    sale.storeId,
  );

  const { totalAmount: expectedTotal } = calculateTotals(sale.payload.items, sale.payload.discountAmount);
  if (Math.abs(persisted.sale.total_amount - expectedTotal) > 0.01) {
    // الإجمالي الرسمي من الخادم يختلف عمّا عرضته الفاتورة دون اتصال —
    // على الأرجح سعر مخزَّن قديم/مزوَّر. يُعلَّم للمراجعة البشرية بدل
    // اعتباره مزامنة ناجحة صامتة.
    outbox = markConflict(outbox, sale.localId, [
      { productId: "__price_mismatch__", productName: "إجمالي الفاتورة", requestedBaseUnits: 0 },
    ]);
    await setOutbox(outbox);
    conflictCount += 1;
    continue;
  }

  outbox = markSynced(outbox, sale.localId);
  ```

### 2. إدخال أسعار من العميل مباشرة في `held_sales` بدون إعادة تسعير من الخادم (دفاع بالعمق)

- **اسم الثغرة:** Unvalidated Client-Supplied Pricing in `held_sales`
- **الملف والسطر:** `services/heldSales.service.ts:29-45`، `supabase/migrations/00000000000010_hold_sale.sql:26-28`
- **سيناريو الاستغلال:** خلافاً لـ `sales`/`shifts` (المقفلة خلف RPC آمنة)، يُدخَل عمود `held_sales.items` (JSONB يحوي `unitPrice`/`costPrice`) مباشرة من العميل دون RPC لإعادة التسعير. حالياً **غير قابل للاستغلال** لأن استئناف البيع المعلّق يمرّ دوماً عبر `create_sale_atomic` عند الدفع الفعلي، والتي تتجاهل السعر المخزَّن في الصف المعلّق وتُعيد اشتقاقه من `product_id`. لكنها فجوة كامنة إن اعتمد أي كود مستقبلي (تقرير، تصدير بيانات) على هذا الحقل كمصدر حقيقي للسعر.
- **كود الإصلاح المقترح:**
  ```ts
  // services/heldSales.service.ts — تخزين هوية المنتج/الكمية فقط، وإعادة
  // اشتقاق السعر من السجل الحي للمنتج عند استئناف البيع المعلّق
  export async function holdSale(supabase: Client, params: HoldSaleParams, storeId: string): Promise<HeldSale> {
    const sanitizedItems = params.items.map(({ productId, name, barcode, quantity, unitName, unitConversionFactor }) => ({
      productId, name, barcode, quantity, unitName, unitConversionFactor,
    }));

    const { data, error } = await supabase
      .from("held_sales")
      .insert({
        cashier_id: params.cashierId,
        items: sanitizedItems as unknown as Record<string, unknown>[],
        discount_amount: params.discountAmount,
        note: params.note,
        store_id: storeId,
        client_local_id: params.clientLocalId ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }
  ```

### ما تم فحصه ولم يظهر فيه أي ثغرة
- **تزوير الكمية/الخصم بالسالب:** جميع حقول الكمية في الواجهة أزرار +/- محصورة عند 1 كحد أدنى، ولا يوجد حقل نصي حر للكمية. حتى لو تم تجاوز القيود في الواجهة، فإن `create_sale_atomic` و`record_return_atomic` يرفضان `quantity <= 0` و`discount_amount` خارج النطاق من جهة الخادم بشكل مستقل.
- **XSS:** لا يوجد أي استخدام لـ `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`document.write` في كامل المشروع. `ReceiptPrinter.tsx` يعرض كل النصوص (اسم الزبون، المنتج، الملاحظات) عبر JSX عادي (محمي تلقائياً من React).
- **قراءة السعر من الكاش عند الإرسال:** مؤكَّد أن `create_sale_atomic` تتجاهل تماماً أي سعر يمر عبر الكاش/العربة/outbox وتُعيد اشتقاقه دوماً من `product_id`.

---

## العميل الرابع: مراقب النزاهة المالية (Financial Integrity Monitor)

**النطاق:** `services/{sales,returns,reconciliations,shifts,inventory}.service.ts`، وآخر نسخة فعلية من `create_sale_atomic`، `record_return`، `adjust_product_stock`، `record_reconciliation`، `close_shift_atomic`، `receive_product_stock`، وقيود الخصم/السعر.

### 1. 🔴 تصعيد مخزون عبر استرجاع المبيعات (`record_return`) بتزوير `unit_conversion_factor` و`product_id`

- **اسم الثغرة:** Return Stock-Restoration Trusts Unvalidated Client Arguments
- **الملف والسطر:** `services/returns.service.ts:59-78` (`recordReturn`)، `supabase/migrations/00000000000037_record_return_reduce_customer_debt.sql:38-141` (`record_return`، النسخة الحالية)
- **سيناريو الاستغلال:** دالة `record_return` (RPC آمنة) تقفل صف `sale_items` الحقيقي فعلياً وتتحقق بشكل صحيح من حدّي الكمية والمبلغ المسترجَع بناءً على ذلك الصف المقفل. **لكنها لا تتحقق أبداً** من معاملين آخرين يمرّرهما المستدعي: `p_product_id` و`p_unit_conversion_factor` — يتم تخزينهما كما هما دون مقارنة بالقيم الحقيقية في صف `sale_items` المقفل. بعد نجاح الـ RPC، الكود في `services/returns.service.ts` يستخدم القيم **القادمة من العميل** (وليس أي قيمة من نتيجة الـ RPC) لتنفيذ إعادة المخزون فعلياً:
  ```ts
  if (params.productId) {
    await incrementStock(supabase, params.productId, toBaseUnits(params.quantity, params.unitConversionFactor));
  }
  ```
  الواجهة الشرعية آمنة لأنها تأخذ هذه القيم من صف بيانات موثوق. لكن أي مهاجم/كاشير يستدعي `supabase.rpc('record_return', {...})` مباشرة (تجاوزاً للواجهة — وهو بالضبط نموذج التهديد الذي صُممت من أجله الهجرات 21/35/37) يستطيع:
  1. اختيار سطر بيع حقيقي وصغير باعه فعلاً (مثلاً كرتونة واحدة، `unit_conversion_factor = 24`) بحيث تمرّ حدود الكمية/المبلغ بسهولة.
  2. تمرير `p_unit_conversion_factor = 2400` بدلاً من القيمة الحقيقية 24 (هذا المعامل غير مُتحقق منه إطلاقاً مقابل الصف المقفل).
  3. نجاح الـ RPC (فحوصات الكمية/المبلغ تعتمد فقط على `p_quantity`/`p_refund_amount`).
  4. استدعاء `incrementStock` بعدها يضيف 2400 وحدة أساسية بدلاً من 24 فقط — مخزون مجاني يمكن بيعه لاحقاً أو "إتلافه" لتغطية السرقة.
  5. كذلك `p_product_id` لا يُقارَن أبداً بـ `v_sale_item.product_id`: يمكن استرجاع سطر بيع رخيص فعلي، مع تمرير `p_product_id` لمنتج آخر أغلى ثمناً بالكامل — تُجرى فحوصات الحد على السطر الرخيص الحقيقي فينجح الطلب، ثم يُعاد المخزون للمنتج الخاطئ (الأغلى) — تخريب صامت للمخزون قابل للتكرار.
  هذا مؤكَّد صراحة عبر اختبار موجود فعلياً (`services/returns.service.test.ts:100-116`) يُثبت أن دلتا المخزون المُرسَلة إلى `adjust_product_stock` هي دالة مباشرة للمعامل القادم من العميل (`unitConversionFactor`)، وليس لأي شيء تحقّقت منه الـ RPC.
- **كود الإصلاح المقترح (SQL + TypeScript):**
  ```sql
  -- تجاهل p_product_id/p_unit_conversion_factor القادمين من العميل عند
  -- إدخال السجل، واستخدام قيم صف sale_items المقفل (الموثوقة) بدلاً منها
  create or replace function public.record_return(
    p_sale_id uuid,
    p_sale_item_id uuid,
    p_product_id uuid,                 -- محتفَظ به لتوافق التوقيع، لم يعد موثوقاً
    p_product_name text,
    p_quantity integer,
    p_unit_label text,                 -- لم يعد موثوقاً
    p_unit_conversion_factor integer,  -- لم يعد موثوقاً
    p_refund_amount numeric,
    p_reason text
  )
  returns setof returns
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_sale_item sale_items%rowtype;
    v_already_returned numeric;
    v_remaining numeric;
    v_max_refund numeric;
    v_customer_id uuid;
    v_inserted_return returns%rowtype;
  begin
    if p_quantity <= 0 then
      raise exception 'الكمية يجب أن تكون أكبر من صفر';
    end if;

    if p_refund_amount < 0 then
      raise exception 'قيمة الاسترجاع يجب أن تكون صفراً أو أكبر';
    end if;

    select * into v_sale_item from sale_items where id = p_sale_item_id for update;

    if not found then
      raise exception 'سطر البيع غير موجود';
    end if;

    if v_sale_item.store_id <> current_store_id() then
      raise exception 'سطر البيع لا يتبع هذا المتجر';
    end if;

    if p_sale_id <> v_sale_item.sale_id then
      raise exception 'سطر البيع لا يتبع هذه الفاتورة';
    end if;

    select coalesce(sum(quantity), 0)
      into v_already_returned
      from returns
      where sale_item_id = p_sale_item_id;

    v_remaining := v_sale_item.quantity - v_already_returned;

    if p_quantity > v_remaining then
      raise exception 'الكمية المطلوب إرجاعها أكبر من المتبقي القابل للإرجاع (المتبقي: %)', v_remaining;
    end if;

    v_max_refund := round(v_sale_item.unit_price * p_quantity, 2);

    if p_refund_amount > v_max_refund then
      raise exception 'قيمة الاسترجاع (%) أكبر من الحد المسموح لهذه الكمية (%)', p_refund_amount, v_max_refund;
    end if;

    insert into returns (
      sale_id, sale_item_id, product_id, product_name, quantity,
      unit_label, unit_conversion_factor, refund_amount, reason,
      actor_id, store_id
    )
    values (
      p_sale_id,
      p_sale_item_id,
      v_sale_item.product_id,             -- موثوق، بدلاً من p_product_id
      v_sale_item.product_name,           -- موثوق، بدلاً من p_product_name
      p_quantity,
      v_sale_item.unit_label,             -- موثوق، بدلاً من p_unit_label
      v_sale_item.unit_conversion_factor, -- موثوق، بدلاً من p_unit_conversion_factor
      p_refund_amount,
      p_reason,
      auth.uid(),
      current_store_id()
    )
    returning * into v_inserted_return;

    select customer_id into v_customer_id from sales where id = p_sale_id;

    if v_customer_id is not null and p_refund_amount > 0 then
      insert into customer_transactions (customer_id, type, amount, sale_id, store_id, cashier_id)
      values (v_customer_id, 'return', p_refund_amount, p_sale_id, current_store_id(), auth.uid());
    end if;

    return next v_inserted_return;
  end;
  $$;
  ```
  ```ts
  // services/returns.service.ts — استخدام الصف المُعاد من الـ RPC نفسها
  // (يحمل الآن product_id/unit_conversion_factor الموثوقَين) بدلاً من
  // المعاملات القادمة من العميل، لتنفيذ إعادة المخزون:
  export async function recordReturn(
    supabase: Client,
    params: RecordReturnParams,
    actorId: string | null,
    storeId: string,
  ): Promise<Return> {
    const { data, error } = await supabase.rpc("record_return", { /* ...بدون تغيير... */ });
    if (error) throw error;

    const inserted = data?.[0];
    if (!inserted) throw new Error("تعذر تسجيل الإرجاع");

    // استخدام inserted.product_id / inserted.unit_conversion_factor
    // (الموثوقَين الآن، مشتقَّين من صف sale_items المقفل) — وليس
    // params.productId / params.unitConversionFactor.
    if (inserted.product_id) {
      await incrementStock(supabase, inserted.product_id, toBaseUnits(inserted.quantity, inserted.unit_conversion_factor));
    }

    await logOperation(supabase, { /* ...بدون تغيير... */ });
    return inserted;
  }
  ```

### 2. 🟢 دالة `adjustStock` تحتوي Race Condition كلاسيكي (كود ميت غير مُستخدم حالياً)

- **اسم الثغرة:** Dead Read-Then-Write TOCTOU Function
- **الملف والسطر:** `services/inventory.service.ts:10-44` (`adjustStock`)
- **سيناريو الاستغلال:** الدالة تقرأ `products.quantity`، تحسب `Math.max(current.quantity + delta, 0)` في كود التطبيق، ثم تنفّذ `.update()` منفصلة بالقيمة المحسوبة — نمط قراءة-ثم-كتابة كلاسيكي عرضة للتسابق: طلبان متزامنان (أو بيع/استرجاع متزامن) قد يقرآن نفس القيمة القديمة فتُفقد إحدى عمليتي التعديل. تم التحقق عبر بحث شامل (`grep`) أن هذه الدالة **لا تُستدعى من أي مكان في المشروع حالياً** — غير قابلة للاستغلال اليوم. تُذكر لأنها: (1) تخالف مبدأ "المرور دائماً عبر RPC ذرية" المُطبَّق في بقية المشروع، (2) خطر كامن إن رُبطت مستقبلاً (مثل شاشة "تعديل مخزون سريع" للأدمن) دون أن يلاحظ أحد أنها تُعيد نفس الثغرة التي أُغلقت في أماكن أخرى.
- **كود الإصلاح المقترح:**
  ```ts
  // services/inventory.service.ts — التوجيه عبر نفس الـ RPC الذرية
  // المستخدمة في بقية المشروع (adjust_product_stock) بدلاً من قراءة-ثم-كتابة
  import { logOperation } from "@/services/archive.service";
  import { decrementStock, incrementStock } from "@/services/products.service";

  export async function adjustStock(
    supabase: Client,
    productId: string,
    delta: number,
    actorId: string | null,
    storeId: string,
  ): Promise<Product> {
    const data = delta >= 0
      ? await incrementStock(supabase, productId, delta)
      : await decrementStock(supabase, productId, -delta);

    if (!data) {
      throw new Error("تعذر تعديل المخزون — الكمية غير كافية أو المنتج غير موجود");
    }

    await logOperation(supabase, {
      userId: actorId,
      actionType: "stock_adjusted",
      entityType: "stock",
      entityId: data.id,
      description: `تم تعديل مخزون "${data.name}" بمقدار ${delta > 0 ? "+" : ""}${delta}`,
      storeId,
    });

    return data;
  }
  ```
  (أو ببساطة حذف الدالة نهائياً إن كانت غير مستخدمة فعلاً، لمنع استخدامها لاحقاً دون وعي بالمشكلة.)

### ما تم فحصه ولم يظهر فيه أي ثغرة
- **إعادة حساب إجمالي الفاتورة من الخادم:** `create_sale_atomic` لا تقبل أبداً إجمالي/مجموع جزئي من العميل — تأخذ فقط `product_id`/`unit_name`/`quantity` لكل سطر وتحسب كل شيء من الخادم. صلاحيات الإدخال المباشر في `sales`/`sale_items` محذوفة تماماً (قراءة فقط).
- **التزامن (Race Conditions) في المخزون:** `adjust_product_stock`، `record_reconciliation`، `receive_product_stock` جميعها تستخدم تحديثاً ذرياً واحداً أو قفل صف حقيقي (`FOR UPDATE`). `record_return` أيضاً تقفل `sale_items` فتُمنع عملية استرجاع مزدوجة لنفس السطر.
- **حدود الكمية/المبلغ المسترجَع:** `record_return` تُحدّد المبلغ المسترجَع بـ `unit_price * quantity` المُشتقّة من الصف المقفل، ولا يوجد مسار لتجاوز ذلك.
- **حدود الخصم والسعر:** قيود CHECK على مستوى الجدول (`discount_amount >= 0 AND <= subtotal`، `sale_price >= 0`) مطبّقة بغض النظر عن مسار الكتابة، والمسار الوحيد هو `create_sale_atomic` التي تتحقق منها إضافياً بشكل مستقل. تعديل أسعار المنتجات مباشرة محصور بالأدمن فقط.
- **إغلاق الوردية/الصندوق:** `close_shift_atomic` تحسب `expected_amount` بالكامل من الخادم من مبيعات/مرتجعات حقيقية، والكاشير يمكنه فقط إدخال المبلغ المعدود فعلياً (`counted_amount`) — وهي حدود طبيعية لأي عملية جرد يدوي، والفرق (`difference`) يُحسب من الخادم ولا يمكن التلاعب به.

---

## التوصيات ذات الأولوية

1. **عاجل:** إصلاح `record_return` لتجاهل `p_product_id`/`p_unit_conversion_factor` القادمَين من العميل، واستخدام القيم الموثوقة من صف `sale_items` المقفل بدلاً منها (البند 1 أعلاه).
2. **مهم:** إنشاء RPC آمنة `record_damage` لتسجيل التلف/الفاقد، مطابقة لنمط `record_return`، وإغلاق الإدخال المباشر في `stock_damages`.
3. **متوسط:** إضافة آلية اكتشاف تعارض بين إجمالي الفاتورة دون اتصال والإجمالي الفعلي عند المزامنة (`syncManager.ts`).
4. **منخفض:** تنظيف/حذف دالة `adjustStock` غير المستخدمة، أو ربطها بالـ RPC الذرية إن كانت ستُستخدم مستقبلاً.
5. **منخفض (دفاع بالعمق):** تجريد `held_sales.items` من حقول السعر عند التخزين.
6. **بنية تحتية للاختبار:** إضافة اختبارات آلية (SQL) للتحقق من عزل المتاجر ورفض الأدوار على مستوى RLS، خصوصاً للدوال الآمنة (`record_return`, `create_sale_atomic`, `close_shift_atomic`, `record_reconciliation`).
