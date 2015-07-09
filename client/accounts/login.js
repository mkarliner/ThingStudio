Template.fullPageTSForm.replaces("fullPageAtForm");
Template.TSTitle.replaces("atTitle");
Template.TSForm.replaces("atForm");
Template.TSLogin.replaces("atPwdForm");
Template.TSPwdFormBtn.replaces("atPwdFormBtn");
Template.TSSignupLink.replaces("atSignupLink");
Template.TSatTextInput.replaces("atTextInput");
Template.TSError.replaces("atError");
Template.TSSigninLink.replaces("atSigninLink");
// Template.atPwdFormBtn.events({
// 	'click .at-btn': function() {
// 		$('.at-btn').html('<div class="login-spinner"><div class="preloader-wrapper small active"><div class="spinner-layer spinner-yellow-only"><div class="circle-clipper left"><div class="circle"></div></div><div class="gap-patch"><div class="circle"></div></div><div class="circle-clipper right"><div class="circle"></div></div></div></div><span>Logging in...</span></div>');
// 	}
// })

// Template.atError.onRendered(function() {
// 	myData = Template.currentData();
// 	console.log('here is myData', this)
// })