
Router.plugin('ensureSignedIn', {
	except: ["ViewApp", "ViewScreen", "ResetPassword"]
});

Router.configure({
	loadingTemplate: 'Loading',
});

AccountsTemplates.configureRoute('signIn', {
	// template: "TSLogin",
	layoutTemplate: "LoginLayout",
	redirect: "/apps"
});

AccountsTemplates.configure({
    texts: {
        errors: {
            accountsCreationDisabled: "Client side accounts creation is disabled!!!",
            cannotRemoveService: "Cannot remove the only active service!",
            captchaVerification: "Captcha verification failed!",
            loginForbidden: "Login failed",
            mustBeLoggedIn: "Please log in",
            pwdMismatch: "error.pwdsDontMatch",
            validationErrors: "Validation Errors",
            verifyEmailFirst: "Please verify your email first. Check the email and follow the link!",
        }
    }
});

T9n.map('en', {
    error: {
        accounts: {
            'Login forbidden': 'Credentials are incorrect!'
        }
    }
});

Router.route("/", function(){
	this.redirect("/apps")
})

Router.route("/logout", function(){
	AccountsTemplates.logout();
});
