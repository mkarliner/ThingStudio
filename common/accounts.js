// myLogoutFunc = function() {
// 	console.log('my logout func running!')
// 	$('.at-error.card-panel').append('<span class="error-text">Signed Out</span>')

// }

var mySubmitFunc = function(error, state){
	// if (error) {
	    	
	//     	$('.top-error .at-error.card-panel').html('<span class="error-text"><i class=\'mdi-alert-warning\'></i> ' + error + '</span>')
	// }
  
	if (!error) {
		if (state === "signIn") {
			$('.at-btn').html('<div class="login-spinner"><div class="preloader-wrapper small active"><div class="spinner-layer spinner-yellow-only"><div class="circle-clipper left"><div class="circle"></div></div><div class="gap-patch"><div class="circle"></div></div><div class="circle-clipper right"><div class="circle"></div></div></div></div><span>Logging in...</span></div>');
		}
		if (state === "signUp") {
			$('.at-btn').html('<div class="login-spinner"><div class="preloader-wrapper small active"><div class="spinner-layer spinner-yellow-only"><div class="circle-clipper left"><div class="circle"></div></div><div class="gap-patch"><div class="circle"></div></div><div class="circle-clipper right"><div class="circle"></div></div></div></div><span>Logging in...</span></div>');
		}
	}
};

// var myLogoutFunc = function(error, state){
//     $('.at-error.card-panel').append('<span class="error-text">Signed Out</span>')
// };



AccountsTemplates.configure({
    // Behaviour
    confirmPassword: true,
    enablePasswordChange: true,
    forbidClientAccountCreation: false,
    overrideLoginErrors: true,
    sendVerificationEmail: false,
    lowercaseUsername: false,

    // Appearance
    showAddRemoveServices: false,
    showForgotPasswordLink: true,
    showLabels: true,
    showPlaceholders: true,
    showResendVerificationEmailLink: false,

    // Client-side Validation
    continuousValidation: false,
    negativeFeedback: false,
    negativeValidation: true,
    positiveValidation: true,
    positiveFeedback: true,
    showValidating: true,

    // Privacy Policy and Terms of Use
    privacyUrl: 'privacy',
    termsUrl: 'terms-of-use',

    // Redirects
    homeRoutePath: '/sign-in',
    // redirectTimeout: 4000,

    // Hooks
    // onLogoutHook: myLogoutFunc,
    onSubmitHook: mySubmitFunc,
    // preSignUpHook: myPreSubmitFunc,

    // Texts
    texts: {
      button: {
          signUp: "Register Now!"
      },
      socialSignUp: "Register",
      socialIcons: {
          "meteor-developer": "fa fa-rocket"
      },
      title: {
          forgotPwd: "Recover Your Password",
          signIn: "Log In",
      },
    },
});

AccountsTemplates.configureRoute('changePwd');
// AccountsTemplates.addField({
// 	_id: "mailing_opt_out",
// 	type: "checkbox",
// 	displayName: "Do not subscribe me to the mailing list",
// });