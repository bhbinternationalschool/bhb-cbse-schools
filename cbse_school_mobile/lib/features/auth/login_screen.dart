import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/config/app_config.dart";
import "../../core/theme/app_theme.dart";

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
    required this.config,
    required this.api,
    required this.onSignedIn,
  });

  final AppConfig config;
  final ApiClient api;
  final VoidCallback onSignedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _mobile = TextEditingController();
  final _otp = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _staffMode = false;
  bool _staffUseOtp = false;
  bool _busy = false;
  bool _otpSent = false;
  String? _maskedMobile;
  String? _error;
  String? _info;

  @override
  void dispose() {
    _mobile.dispose();
    _otp.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      await action();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = "Could not reach the school server. Try again.",
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendOtp() => _run(() async {
    final masked = _staffMode
        ? await widget.api.requestStaffOtp(_mobile.text.trim())
        : await widget.api.requestOtp(_mobile.text.trim());
    if (!mounted) return;
    setState(() {
      _otpSent = true;
      _maskedMobile = masked;
      _info = "OTP sent on WhatsApp to $masked";
    });
  });

  Future<void> _verifyOtp() => _run(() async {
    if (_staffMode) {
      await widget.api.verifyStaffOtp(_mobile.text.trim(), _otp.text.trim());
    } else {
      await widget.api.verifyOtp(_mobile.text.trim(), _otp.text.trim());
    }
    if (mounted) widget.onSignedIn();
  });

  Future<void> _staffSignIn() => _run(() async {
    await widget.api.staffLogin(_email.text.trim(), _password.text);
    if (mounted) widget.onSignedIn();
  });

  Future<void> _devLogin() => _run(() async {
    // Dev affordances via the email field: a roster id (stf_…) links the
    // demo session to that staff record as a teacher; "driver" signs in
    // as the field/driver persona; empty stays the principal demo.
    final email = _email.text.trim().toLowerCase();
    final isDriver = _staffMode && (email == "driver" || email == "field");
    // "stf_xxx" links a roster record as a teacher; "stf_xxx:office" (or
    // :accounts, :support…) links it with that role so the desk home
    // can be exercised without a real OTP login.
    final isTeacher = _staffMode && email.startsWith("stf_");
    final parts = email.split(":");
    await widget.api.devLogin(
      persona: isDriver
          ? "field"
          : _staffMode
          ? "staff"
          : "parent",
      householdId: _staffMode ? null : _mobile.text.trim(),
      staffId: isTeacher ? parts.first : null,
      roleCode: isTeacher ? (parts.length > 1 ? parts[1] : "teacher") : null,
    );
    if (mounted) widget.onSignedIn();
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Image.asset(
                    "assets/images/logo-crest.png",
                    height: 96,
                    fit: BoxFit.contain,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    widget.config.schoolName,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      color: AppColors.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 16),
                  SegmentedButton<bool>(
                    segments: const [
                      ButtonSegment(
                        value: false,
                        label: Text("Parent"),
                        icon: Icon(Icons.family_restroom_outlined),
                      ),
                      ButtonSegment(
                        value: true,
                        label: Text("Staff"),
                        icon: Icon(Icons.badge_outlined),
                      ),
                    ],
                    selected: {_staffMode},
                    onSelectionChanged: _busy
                        ? null
                        : (s) => setState(() {
                            _staffMode = s.first;
                            _staffUseOtp = false;
                            _otpSent = false;
                            _otp.clear();
                            _error = null;
                            _info = null;
                          }),
                  ),
                  if (_staffMode) ...[
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: _busy
                            ? null
                            : () => setState(() {
                                _staffUseOtp = !_staffUseOtp;
                                _otpSent = false;
                                _otp.clear();
                                _error = null;
                                _info = null;
                              }),
                        child: Text(
                          _staffUseOtp
                              ? "Sign in with password instead"
                              : "Sign in with OTP instead",
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  if (!_staffMode || _staffUseOtp) ...[
                    TextField(
                      controller: _mobile,
                      enabled: !_otpSent,
                      keyboardType: TextInputType.phone,
                      autofillHints: const [AutofillHints.telephoneNumber],
                      decoration: const InputDecoration(
                        labelText: "Mobile number",
                        hintText: "10-digit WhatsApp number",
                      ),
                    ),
                    if (_otpSent) ...[
                      const SizedBox(height: 12),
                      TextField(
                        controller: _otp,
                        keyboardType: TextInputType.number,
                        maxLength: 6,
                        autofillHints: const [AutofillHints.oneTimeCode],
                        decoration: InputDecoration(
                          labelText: "OTP",
                          hintText: "6-digit code from WhatsApp",
                          counterText: "",
                          helperText: _maskedMobile == null
                              ? null
                              : "Sent to $_maskedMobile",
                        ),
                      ),
                    ],
                  ] else ...[
                    TextField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.username],
                      decoration: const InputDecoration(
                        labelText: "School email",
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _password,
                      obscureText: true,
                      autofillHints: const [AutofillHints.password],
                      decoration: const InputDecoration(labelText: "Password"),
                    ),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _error!,
                      style: const TextStyle(color: AppColors.danger),
                    ),
                  ],
                  if (_info != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _info!,
                      style: const TextStyle(color: AppColors.success),
                    ),
                  ],
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _busy
                        ? null
                        : _staffMode && !_staffUseOtp
                        ? _staffSignIn
                        : _otpSent
                        ? _verifyOtp
                        : _sendOtp,
                    child: _busy
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(
                            _staffMode && !_staffUseOtp
                                ? "Sign in"
                                : _otpSent
                                ? "Verify & sign in"
                                : "Send OTP",
                          ),
                  ),
                  if ((!_staffMode || _staffUseOtp) && _otpSent) ...[
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: _busy
                          ? null
                          : () => setState(() {
                              _otpSent = false;
                              _otp.clear();
                              _info = null;
                              _error = null;
                            }),
                      child: const Text("Change mobile number"),
                    ),
                  ],
                  if (AppConfig.devLogin) ...[
                    const SizedBox(height: 8),
                    OutlinedButton(
                      onPressed: _busy ? null : _devLogin,
                      child: Text(
                        _staffMode
                            ? "Dev: sign in as staff"
                            : "Dev: sign in as household id",
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  Text(
                    "API: ${widget.config.apiBaseUrl}",
                    style: Theme.of(context).textTheme.bodySmall,
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
