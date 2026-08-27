-- The school still writes paper receipts from the printed book at the store
-- counter. The clerk needs to record that book number on the digital sale so
-- the two can be matched later. Optional, free-text, no uniqueness — two
-- books can run in parallel and a family sale repeats one number per child.

alter table public.inv_sales
  add column if not exists manual_receipt_no text not null default '';

notify pgrst, 'reload schema';
