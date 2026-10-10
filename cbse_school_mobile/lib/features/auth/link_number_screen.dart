import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

/// A parent on a phone the school never recorded links it to their family
/// (director, 10 Oct 2026; ERP lib/parentNumberLink):
///
///  1. the child — admission number OR name — and the exact date of birth;
///  2. a WhatsApp code goes to the family's REGISTERED number (shown masked);
///     typing it links this number and signs in;
///  3. without that phone, or if nothing matches: "Ask the school office".
class LinkNumberScreen extends StatefulWidget {
  const LinkNumberScreen({
    super.key,
    required this.api,
    required this.mobile,
    required this.onSignedIn,
  });

  final ApiClient api;
  final String mobile;
  final VoidCallback onSignedIn;

  @override
  State<LinkNumberScreen> createState() => _LinkNumberScreenState();
}

class _LinkNumberScreenState extends State<LinkNumberScreen> {
  final _name = TextEditingController();
  final _admission = TextEditingController();
  final _code = TextEditingController();
  final _note = TextEditingController();
  DateTime? _dob;
  String _className = "";
  List<String> _classes = const [];
  String _linkId = "";
  String _masked = "";
  bool _busy = false;
  bool _offerOffice = false;
  String _error = "";
  String _info = "";

  bool get _hi => Localizations.localeOf(context).languageCode == "hi";
  String _t(String en, String hi) => _hi ? hi : en;

  String get _dobIso => _dob == null
      ? ""
      : "${_dob!.year.toString().padLeft(4, "0")}-${_dob!.month.toString().padLeft(2, "0")}-${_dob!.day.toString().padLeft(2, "0")}";

  @override
  void dispose() {
    _name.dispose();
    _admission.dispose();
    _code.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = "";
    });
    try {
      await action();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = _t("Could not reach the school server — try again.", "स्कूल सर्वर से नहीं जुड़ पाए — फिर कोशिश करें।"));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _dob ?? DateTime(now.year - 8),
      firstDate: DateTime(now.year - 22),
      lastDate: now,
      helpText: _t("Child's date of birth", "बच्चे की जन्म तिथि"),
    );
    if (d != null) setState(() => _dob = d);
  }

  Future<void> _start() => _run(() async {
        if (_dob == null || (_name.text.trim().isEmpty && _admission.text.trim().isEmpty)) {
          setState(() => _error = _t(
                "Enter the child's name (or admission number) and date of birth.",
                "बच्चे का नाम (या प्रवेश संख्या) और जन्म तिथि भरें।",
              ));
          return;
        }
        final r = await widget.api.linkNumberStart(
          mobile: widget.mobile,
          childName: _name.text.trim(),
          admissionNo: _admission.text.trim(),
          dob: _dobIso,
          className: _className,
        );
        if (!mounted) return;
        if (r.codeSent) {
          setState(() {
            _linkId = r.linkId;
            _masked = r.maskedRegistered;
            _info = "";
          });
        } else if (r.needClass) {
          setState(() {
            _classes = r.classes;
            _error = _t("More than one child matches — choose the class.", "एक से अधिक बच्चे मिले — कक्षा चुनें।");
          });
        } else {
          setState(() {
            _offerOffice = true;
            _error = r.message;
          });
        }
      });

  Future<void> _verify() => _run(() async {
        await widget.api.linkNumberVerify(_linkId, _code.text.trim());
        if (mounted) widget.onSignedIn();
      });

  Future<void> _askOffice() => _run(() async {
        final msg = await widget.api.linkNumberAskOffice(
          mobile: widget.mobile,
          childName: _name.text.trim(),
          admissionNo: _admission.text.trim(),
          dob: _dobIso,
          className: _className,
          note: _note.text.trim(),
        );
        if (mounted) {
          setState(() {
            _info = msg.isNotEmpty
                ? msg
                : _t("Sent to the school office.", "स्कूल कार्यालय को भेज दिया गया।");
            _offerOffice = false;
          });
        }
      });

  @override
  Widget build(BuildContext context) {
    final codeStep = _linkId.isNotEmpty;
    return Scaffold(
      appBar: AppBar(title: Text(_t("Link this number", "यह नंबर जोड़ें"))),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              _t(
                "${widget.mobile} is not on the school's record. Tell us your child, and we will send a code to the number the school has for your family.",
                "${widget.mobile} स्कूल के रिकॉर्ड में नहीं है। अपने बच्चे की जानकारी दें — स्कूल में दर्ज आपके परिवार के नंबर पर कोड भेजा जाएगा।",
              ),
            ),
            const SizedBox(height: 16),
            if (!codeStep) ...[
              TextField(
                controller: _name,
                textCapitalization: TextCapitalization.words,
                decoration: InputDecoration(labelText: _t("Child's name", "बच्चे का नाम")),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _admission,
                decoration: InputDecoration(
                  labelText: _t("Admission number (if you know it)", "प्रवेश संख्या (यदि पता हो)"),
                ),
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: _busy ? null : _pickDob,
                icon: const Icon(Icons.cake_outlined),
                label: Text(_dob == null ? _t("Child's date of birth", "बच्चे की जन्म तिथि") : _dobIso),
              ),
              if (_classes.isNotEmpty) ...[
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _className.isEmpty ? null : _className,
                  items: [for (final c in _classes) DropdownMenuItem(value: c, child: Text(c))],
                  onChanged: (v) => setState(() => _className = v ?? ""),
                  decoration: InputDecoration(labelText: _t("Class", "कक्षा")),
                ),
              ],
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _busy ? null : _start,
                child: Text(_t("Send code to the family's number", "परिवार के नंबर पर कोड भेजें")),
              ),
            ] else ...[
              Text(
                _t(
                  "A code was sent on WhatsApp to $_masked — the number the school has for your family. Ask whoever has that phone for the code.",
                  "स्कूल में दर्ज आपके परिवार के नंबर $_masked पर WhatsApp से कोड भेजा गया है। जिसके पास वह फ़ोन है, उनसे कोड लें।",
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: InputDecoration(labelText: _t("6-digit code", "6 अंकों का कोड"), counterText: ""),
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _busy ? null : _verify,
                child: Text(_t("Link and sign in", "जोड़ें और लॉगिन करें")),
              ),
            ],
            if (_error.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(_error, style: const TextStyle(color: AppColors.danger)),
            ],
            if (_info.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(_info, style: const TextStyle(color: AppColors.success)),
            ],
            const SizedBox(height: 20),
            const Divider(),
            if (_offerOffice || codeStep) ...[
              TextField(
                controller: _note,
                decoration: InputDecoration(
                  labelText: _t("Note for the office (optional)", "कार्यालय के लिए संदेश (वैकल्पिक)"),
                ),
              ),
              const SizedBox(height: 8),
            ],
            TextButton(
              onPressed: _busy ? null : _askOffice,
              child: Text(
                _t(
                  "Don't have the family's phone? Ask the school office",
                  "परिवार का फ़ोन पास नहीं है? स्कूल कार्यालय से अनुरोध करें",
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
