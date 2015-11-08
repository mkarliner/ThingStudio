
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

// AccountsTemplates.configureRoute('ensureSignedIn', {
//     template: 'myLogin',
//     layoutTemplate: 'myLayout',
// });

Router.route("/", function(){
	this.redirect("/apps")
})

Router.route("/logout", function(){
	AccountsTemplates.logout();
});
