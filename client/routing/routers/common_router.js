Router.configure({
	layoutTemplate: 'GeneralLayout',
	loadingTemplate: 'Loading',
	controller: 'IDEController'
});

Router.onBeforeAction(function(par) {
	if (!Meteor.user() && !Meteor.loggingIn()) {
		this.layout("HelpLayout");
		this.render("Login");
	} else {
		this.next();
	}
}, { except: []});

AccountsTemplates.configureRoute('signIn');

Router.route("/logout", function(){
	AccountsTemplates.logout();
});
